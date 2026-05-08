import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_010 } from '../src/rules/sql-010-correlated-subquery.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_010(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-010 — fires on correlated subqueries in projection', () => {
  it('fires on classic per-row count subquery', () => {
    const c = fire(
      'SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id) FROM users u',
    );
    expect(c?.code).toBe('SQL-010');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(75);
    expect(c?.threatCategories).toContain('integrity');
  });

  it('fires when subquery references outer alias for a non-aggregate', () => {
    expect(
      fire(
        'SELECT u.id, (SELECT name FROM products p WHERE p.id = u.fav_product) FROM users u',
      )?.code,
    ).toBe('SQL-010');
  });

  it('fires when outer reference uses bare relname (no alias)', () => {
    expect(
      fire(
        'SELECT id, (SELECT max(amount) FROM orders WHERE orders.user_id = users.id) FROM users',
      )?.code,
    ).toBe('SQL-010');
  });

  it('fires on EXISTS-shaped projection — wait, EXISTS is its own SubLinkType, so this stays correlated-EXPR-SUBLINK only', () => {
    // We test only EXPR_SUBLINK shapes; EXISTS uses EXISTS_SUBLINK.
    expect(
      fire(
        'SELECT u.id, (SELECT count(*) FROM ban b WHERE b.user_id = u.id) AS banned_count FROM users u',
      )?.code,
    ).toBe('SQL-010');
  });

  it('fires when projection has AS alias', () => {
    expect(
      fire(
        'SELECT u.email, (SELECT count(*) FROM orders o WHERE o.user_id = u.id) AS n_orders FROM users u',
      )?.code,
    ).toBe('SQL-010');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-010 — does not fire on uncorrelated / out-of-scope shapes', () => {
  it('does not fire on uncorrelated subquery in projection', () => {
    expect(
      fire('SELECT id, (SELECT max(x) FROM other) FROM users'),
    ).toBeNull();
  });

  it('does not fire on correlated subquery in WHERE (out of scope)', () => {
    expect(
      fire(
        'SELECT u.id FROM users u WHERE u.id IN (SELECT user_id FROM banned b WHERE b.user_id = u.id)',
      ),
    ).toBeNull();
  });

  it('does not fire on plain SELECT without subqueries', () => {
    expect(fire('SELECT id, email FROM users')).toBeNull();
    expect(fire('SELECT * FROM users WHERE active = true')).toBeNull();
  });

  it('does not fire on JOIN-based equivalent', () => {
    expect(
      fire(
        'SELECT u.id, count(o.id) FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id',
      ),
    ).toBeNull();
  });

  it('does not fire on UPDATE / DELETE (different stmt type)', () => {
    expect(fire('UPDATE users SET email=$1 WHERE id=1')).toBeNull();
    expect(fire('DELETE FROM users WHERE id=1')).toBeNull();
  });

  it('does not fire when subquery references its own alias only', () => {
    // Subquery has its own table aliased as 'self'; references that
    // alias internally. No outer reference.
    expect(
      fire(
        'SELECT id, (SELECT count(*) FROM orders self WHERE self.id > 0) FROM users',
      ),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-010 — edge cases', () => {
  it('fires once when multiple correlated subqueries appear in same SELECT', () => {
    expect(
      fire(
        'SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id), (SELECT count(*) FROM logins l WHERE l.user_id = u.id) FROM users u',
      )?.code,
    ).toBe('SQL-010');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_010(cursor)).not.toThrow();
    expect(SQL_010(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_010(r.ast)).toBeNull();
  });

  it('does not fire when subquery has no whereClause (uncorrelated)', () => {
    expect(
      fire('SELECT id, (SELECT count(*) FROM orders) FROM users'),
    ).toBeNull();
  });

  it('handles schema-qualified outer table', () => {
    expect(
      fire(
        'SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id) FROM public.users u',
      )?.code,
    ).toBe('SQL-010');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-010 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire(
      'SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id) FROM users u',
    );
    expect(c).toMatchObject({
      code: 'SQL-010',
      title: 'Correlated subquery in SELECT projection',
      severity: 'warn',
      confidence: 75,
      threatCategories: ['integrity'],
    });
    expect(c?.detail).toContain('u');
    expect(c?.fix).toContain('JOIN');
  });
});
