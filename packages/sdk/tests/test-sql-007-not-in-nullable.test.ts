import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_007 } from '../src/rules/sql-007-not-in-nullable.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_007(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-007 — fires on unguarded NOT IN subqueries', () => {
  it('fires on basic NOT IN (SELECT col FROM other)', () => {
    const c = fire(
      'SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned)',
    );
    expect(c?.code).toBe('SQL-007');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(80);
    expect(c?.threatCategories).toContain('corruption');
  });

  it('fires when NOT IN is one of multiple WHERE conditions', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE active = true AND id NOT IN (SELECT manager_id FROM employees)',
      )?.code,
    ).toBe('SQL-007');
  });

  it('fires when subquery has its own WHERE filter (no NULL guard)', () => {
    expect(
      fire(
        "SELECT * FROM products WHERE id NOT IN (SELECT product_id FROM orders WHERE created_at > '2024-01-01')",
      )?.code,
    ).toBe('SQL-007');
  });

  it('fires when NOT IN appears inside HAVING', () => {
    expect(
      fire(
        'SELECT count(*) FROM x HAVING max(id) NOT IN (SELECT y_id FROM y)',
      )?.code,
    ).toBe('SQL-007');
  });

  it('fires on NOT IN in UPDATE WHERE', () => {
    expect(
      fire(
        'UPDATE users SET active = false WHERE id NOT IN (SELECT user_id FROM premium)',
      )?.code,
    ).toBe('SQL-007');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-007 — does not fire on safe shapes', () => {
  it('does not fire when subquery has IS NOT NULL guard on projected column', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned WHERE user_id IS NOT NULL)',
      ),
    ).toBeNull();
  });

  it('does not fire on NOT IN with literal list (different AST)', () => {
    expect(fire('SELECT * FROM users WHERE id NOT IN (1, 2, 3)')).toBeNull();
  });

  it('does not fire when projection uses coalesce', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE id NOT IN (SELECT coalesce(user_id, 0) FROM banned)',
      ),
    ).toBeNull();
  });

  it('does not fire when projection uses nullif', () => {
    expect(
      fire(
        "SELECT * FROM users WHERE id NOT IN (SELECT nullif(user_id, '') FROM banned)",
      ),
    ).toBeNull();
  });

  it('does not fire on NOT EXISTS (different AST shape)', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE NOT EXISTS (SELECT 1 FROM banned WHERE user_id = users.id)',
      ),
    ).toBeNull();
  });

  it('does not fire on plain IN (no NOT)', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE id IN (SELECT user_id FROM premium)',
      ),
    ).toBeNull();
  });

  it('does not fire on plain SELECT with no NOT IN', () => {
    expect(fire('SELECT * FROM users WHERE active = true')).toBeNull();
  });

  it('does not fire when guard is anonymous (handles partial-info gracefully)', () => {
    // If the projection is a function call but not coalesce/nullif,
    // we don't know the column name; the IS NOT NULL guard match
    // accepts any IS NOT NULL test as "good enough" then.
    expect(
      fire(
        'SELECT * FROM users WHERE id NOT IN (SELECT to_char(user_id) FROM banned WHERE user_id IS NOT NULL)',
      ),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-007 — edge cases', () => {
  it('fires when the IS NOT NULL guard is on a DIFFERENT column', () => {
    // IS NOT NULL on `name` doesn't guard `user_id` — the projection
    // can still be NULL.
    expect(
      fire(
        'SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned WHERE name IS NOT NULL)',
      )?.code,
    ).toBe('SQL-007');
  });

  it('fires once on multiple unguarded NOT IN clauses (single-fire)', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE id NOT IN (SELECT a FROM x) AND email NOT IN (SELECT b FROM y)',
      )?.code,
    ).toBe('SQL-007');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_007(cursor)).not.toThrow();
    expect(SQL_007(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_007(r.ast)).toBeNull();
  });

  it('handles qualified column refs in subquery projection', () => {
    expect(
      fire(
        'SELECT * FROM users WHERE id NOT IN (SELECT b.user_id FROM banned b)',
      )?.code,
    ).toBe('SQL-007');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-007 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire(
      'SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned)',
    );
    expect(c).toMatchObject({
      code: 'SQL-007',
      title: 'NOT IN with potentially-nullable subquery',
      severity: 'warn',
      confidence: 80,
      threatCategories: ['corruption'],
    });
    expect(c?.detail).toContain('three-valued logic');
    expect(c?.fix).toContain('IS NOT NULL');
  });
});
