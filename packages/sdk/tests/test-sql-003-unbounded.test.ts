import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_003 } from '../src/rules/sql-003-unbounded.js';

// STORY 2.1 — SQL-003 Unbounded UPDATE / DELETE tests.
// Distribution: 5+ positive, 3+ negative, 2+ edge cases.

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_003(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-003 — fires on unbounded UPDATE / DELETE', () => {
  it("fires on UPDATE table SET col='x'", () => {
    const c = fire("UPDATE users SET email = 'x'");
    expect(c?.code).toBe('SQL-003');
    expect(c?.title).toContain('UPDATE');
    expect(c?.severity).toBe('block');
    expect(c?.confidence).toBe(99);
    expect(c?.threatCategories).toContain('destruction');
  });

  it('fires on UPDATE with multiple SET assignments and no WHERE', () => {
    const c = fire("UPDATE users SET email = 'x', name = 'y'");
    expect(c?.code).toBe('SQL-003');
    expect(c?.detail).toContain('users');
  });

  it('fires on DELETE FROM table with no WHERE', () => {
    const c = fire('DELETE FROM users');
    expect(c?.code).toBe('SQL-003');
    expect(c?.title).toContain('DELETE');
    expect(c?.confidence).toBe(97);
  });

  it('fires on DELETE FROM schema.table with no WHERE', () => {
    const c = fire('DELETE FROM public.users');
    expect(c?.code).toBe('SQL-003');
    expect(c?.detail).toContain('public.users');
  });

  it('fires on UPDATE ... RETURNING (RETURNING is not a WHERE)', () => {
    const c = fire("UPDATE users SET email = 'x' RETURNING id");
    expect(c?.code).toBe('SQL-003');
  });

  it('fires on UPDATE with CTE prefix (CTE does not add a WHERE)', () => {
    const c = fire('WITH cte AS (SELECT 1) UPDATE users SET x = 1');
    expect(c?.code).toBe('SQL-003');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-003 — does not fire on bounded statements', () => {
  it('does not fire on UPDATE ... WHERE id = 1', () => {
    expect(fire('UPDATE users SET email = $1 WHERE id = 1')).toBeNull();
  });

  it('does not fire on DELETE ... WHERE id = 1', () => {
    expect(fire('DELETE FROM users WHERE id = 1')).toBeNull();
  });

  it('does not fire on UPDATE ... WHERE id IN (SELECT ...)', () => {
    expect(
      fire(
        'UPDATE users SET email = $1 WHERE id IN (SELECT user_id FROM allowed)',
      ),
    ).toBeNull();
  });

  it('does not fire on DELETE ... USING ... WHERE (joined delete)', () => {
    expect(fire('DELETE FROM a USING b WHERE a.id = b.id')).toBeNull();
  });

  it('does not fire on TRUNCATE (different statement type)', () => {
    expect(fire('TRUNCATE TABLE users')).toBeNull();
  });

  it('does not fire on INSERT INTO ... ON CONFLICT DO UPDATE (different shape)', () => {
    const c = fire(
      "INSERT INTO users (id, email) VALUES (1, 'x@y.com') " +
        'ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email',
    );
    // The ON CONFLICT DO UPDATE has its own action that isn't an
    // UpdateStmt node; SQL-003 should not fire on this AST shape.
    expect(c).toBeNull();
  });

  it('does not fire on SELECT (different statement type)', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-003 — edge cases', () => {
  it('fires on the FIRST unbounded stmt in a multi-statement script', () => {
    const c = fire('UPDATE a SET x = 1; UPDATE b SET x = 1 WHERE y = 2');
    expect(c?.code).toBe('SQL-003');
    expect(c?.detail).toContain('a');
  });

  it('fires on first when bounded comes before unbounded', () => {
    const c = fire('UPDATE a SET x = 1 WHERE y = 2; DELETE FROM b');
    expect(c?.code).toBe('SQL-003');
    expect(c?.detail).toContain('b');
    expect(c?.title).toContain('DELETE');
  });

  it('does not fire on empty / whitespace SQL (no statement)', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_003(r.ast)).toBeNull();
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_003(cursor)).not.toThrow();
    expect(SQL_003(cursor)).toBeNull();
  });

  it('handles missing relation name gracefully', () => {
    // Hand-crafted AST with malformed relation — should not crash.
    const ast = {
      stmts: [
        {
          stmt: {
            UpdateStmt: {
              relation: null, // malformed
              targetList: [],
            },
          },
        },
      ],
    };
    const c = SQL_003(ast);
    expect(c?.code).toBe('SQL-003');
    expect(c?.detail).toContain('<unknown>');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-003 — output stability', () => {
  it('UPDATE canonical case has stable shape and confidence 99', () => {
    const c = fire("UPDATE users SET email = 'x'");
    expect(c).toMatchObject({
      code: 'SQL-003',
      title: 'Unbounded UPDATE statement',
      severity: 'block',
      confidence: 99,
      threatCategories: ['destruction'],
    });
    expect(typeof c?.detail).toBe('string');
    expect(typeof c?.fix).toBe('string');
  });

  it('DELETE canonical case has stable shape and confidence 97', () => {
    const c = fire('DELETE FROM users');
    expect(c).toMatchObject({
      code: 'SQL-003',
      title: 'Unbounded DELETE statement',
      severity: 'block',
      confidence: 97,
      threatCategories: ['destruction'],
    });
  });
});
