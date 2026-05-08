import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_011 } from '../src/rules/sql-011-aggregate-no-groupby.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_011(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-011 — fires on aggregate + naked column without GROUP BY', () => {
  it('fires on count(*) + name', () => {
    const c = fire('SELECT count(*), name FROM users');
    expect(c?.code).toBe('SQL-011');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(90);
    expect(c?.threatCategories).toContain('corruption');
  });

  it('fires on sum(amount) + category', () => {
    expect(fire('SELECT sum(amount), category FROM orders')?.code).toBe(
      'SQL-011',
    );
  });

  it('fires on max(salary) + department', () => {
    expect(
      fire('SELECT max(salary), department FROM employees')?.code,
    ).toBe('SQL-011');
  });

  it('fires on array_agg(id) + status', () => {
    expect(fire('SELECT array_agg(id), status FROM tickets')?.code).toBe(
      'SQL-011',
    );
  });

  it('fires when both aggregate and naked column appear in mixed order', () => {
    expect(
      fire('SELECT count(*), name, max(amount) FROM users')?.code,
    ).toBe('SQL-011');
  });

  it('fires on string_agg(...) + name', () => {
    expect(
      fire("SELECT string_agg(email, ','), name FROM users")?.code,
    ).toBe('SQL-011');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-011 — does not fire on safe shapes', () => {
  it('does not fire on count(*) + name with GROUP BY name', () => {
    expect(
      fire('SELECT count(*), name FROM users GROUP BY name'),
    ).toBeNull();
  });

  it('does not fire on all-aggregate projection', () => {
    expect(
      fire('SELECT count(*), sum(amount), max(price) FROM orders'),
    ).toBeNull();
  });

  it('does not fire on count(*) OVER () + name (window function)', () => {
    expect(
      fire('SELECT count(*) OVER (), name FROM users'),
    ).toBeNull();
  });

  it('does not fire on plain SELECT with no aggregates', () => {
    expect(fire('SELECT name, email FROM users')).toBeNull();
    expect(fire('SELECT * FROM users')).toBeNull();
  });

  it('does not fire on count(name) (column wrapped in aggregate)', () => {
    expect(fire('SELECT count(name) FROM users')).toBeNull();
  });

  it('does not fire on UPDATE / DELETE (different stmt type)', () => {
    expect(fire('UPDATE users SET email=$1 WHERE id=1')).toBeNull();
    expect(fire('DELETE FROM users WHERE id=1')).toBeNull();
  });

  it('does not fire on count(*) + literal (literal is not a naked column)', () => {
    expect(
      fire("SELECT count(*), 'static' AS marker FROM users"),
    ).toBeNull();
  });

  it('does not fire on subquery scalar in SELECT alongside aggregate', () => {
    // `(SELECT max(x) FROM t)` is a subquery scalar, not a naked
    // column ref of the outer SELECT.
    expect(
      fire(
        'SELECT count(*), (SELECT max(x) FROM other) FROM users',
      ),
    ).toBeNull();
  });

  it('does not fire when the aggregate lives only in a scalar subquery', () => {
    // Discovered via the V1.5 playground (SQL-010 sample). The outer
    // query has a naked column `u.id` and a scalar subquery
    // containing count(*). Aggregate scope is per-query — Postgres
    // does NOT reject this — so SQL-011 must not fire.
    expect(
      fire(
        `SELECT u.id,
                (SELECT count(*) FROM orders o WHERE o.user_id = u.id) AS n
         FROM users u`,
      ),
    ).toBeNull();
  });

  it('does not fire on naked outer column + scalar subquery returning a column', () => {
    // Symmetric to the above: subquery returns a column, outer has
    // a naked column. No outer aggregate at all, so SQL-011 should
    // remain silent — the inner SELECT lives in its own scope.
    expect(
      fire(
        'SELECT id, (SELECT max(x) FROM t) FROM users',
      ),
    ).toBeNull();
  });

  it('does not fire on naked outer column + EXISTS subquery containing count(*)', () => {
    // EXISTS and IN subqueries are also SubLinks; same scope story.
    expect(
      fire(
        `SELECT id FROM users u
         WHERE EXISTS (SELECT count(*) FROM orders o WHERE o.user_id = u.id)`,
      ),
    ).toBeNull();
  });

  it('does not fire when an outer FuncCall arg wraps a scalar subquery with count(*)', () => {
    // coalesce(...) is not an aggregate; the count(*) lives inside
    // a SubLink inside coalesce's arg. Visit must still stop at the
    // SubLink boundary regardless of how many non-aggregate
    // FuncCalls wrap it.
    expect(
      fire(
        `SELECT id, coalesce((SELECT count(*) FROM orders), 0) FROM users`,
      ),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-011 — edge cases', () => {
  it('fires on aggregate inside WHERE-style HAVING shape too', () => {
    // count(*) HAVING count(*) > 1 has count(*) as both projection
    // and HAVING — but no naked column, so no fire.
    expect(
      fire('SELECT count(*) FROM users HAVING count(*) > 1'),
    ).toBeNull();
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_011(cursor)).not.toThrow();
    expect(SQL_011(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_011(r.ast)).toBeNull();
  });

  it('fires on schema-qualified aggregate (pg_catalog.count)', () => {
    expect(
      fire('SELECT pg_catalog.count(*), name FROM users')?.code,
    ).toBe('SQL-011');
  });

  it('does not fire on user-defined function (not in aggregate catalog)', () => {
    // my_custom_func() isn't in our catalog — treated as non-aggregate
    expect(
      fire('SELECT my_custom_func(*), name FROM users'),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-011 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire('SELECT count(*), name FROM users');
    expect(c).toMatchObject({
      code: 'SQL-011',
      title: 'Aggregate with non-aggregated column and no GROUP BY',
      severity: 'warn',
      confidence: 90,
      threatCategories: ['corruption'],
    });
    expect(c?.detail).toContain('count');
    expect(c?.detail).toContain('name');
    expect(c?.fix).toContain('GROUP BY');
  });
});
