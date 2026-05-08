import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_014 } from '../src/rules/sql-014-missing-returning.js';

// V1.1 — SQL-014 missing RETURNING tests.
// Default-OFF, opt-in rule. The rule itself fires whenever invoked
// (default-OFF behavior is enforced by the registry, not here). These
// tests verify the rule's detection logic in isolation.

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_014(r.ast);
}

// ----------------------------------------------------------------------
// Positive — INSERT/UPDATE/DELETE without RETURNING
// ----------------------------------------------------------------------

describe('SQL-014 — fires on writes without RETURNING', () => {
  it('fires on INSERT without RETURNING', () => {
    const c = fire("INSERT INTO users (email) VALUES ('a@b.com')");
    expect(c?.code).toBe('SQL-014');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(50);
    expect(c?.title).toContain('INSERT');
    expect(c?.detail).toContain('users');
    expect(c?.threatCategories).toContain('integrity');
  });

  it('fires on UPDATE without RETURNING', () => {
    const c = fire("UPDATE users SET email = 'x' WHERE id = 1");
    expect(c?.code).toBe('SQL-014');
    expect(c?.title).toContain('UPDATE');
    expect(c?.detail).toContain('users');
  });

  it('fires on DELETE without RETURNING', () => {
    const c = fire('DELETE FROM users WHERE id = 1');
    expect(c?.code).toBe('SQL-014');
    expect(c?.title).toContain('DELETE');
  });

  it('fires on schema-qualified INSERT', () => {
    const c = fire(
      "INSERT INTO public.users (email) VALUES ('a@b.com')",
    );
    expect(c?.code).toBe('SQL-014');
    expect(c?.detail).toContain('public.users');
  });

  it('fires on UPSERT without outer RETURNING', () => {
    const c = fire(
      "INSERT INTO users (id, email) VALUES (1, 'a@b.com') " +
        'ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email',
    );
    expect(c?.code).toBe('SQL-014');
  });

  it('fires on multi-row INSERT without RETURNING', () => {
    const c = fire(
      "INSERT INTO users (email) VALUES ('a@b.com'), ('c@d.com')",
    );
    expect(c?.code).toBe('SQL-014');
  });

  it('fires on UPDATE with CTE prefix and no RETURNING', () => {
    const c = fire(
      'WITH cte AS (SELECT 1) UPDATE users SET x = 1 WHERE id = 1',
    );
    expect(c?.code).toBe('SQL-014');
  });
});

// ----------------------------------------------------------------------
// Negative — writes WITH RETURNING, and non-write statements
// ----------------------------------------------------------------------

describe('SQL-014 — does not fire when RETURNING is present', () => {
  it('does not fire on INSERT ... RETURNING id', () => {
    expect(
      fire("INSERT INTO users (email) VALUES ('a@b.com') RETURNING id"),
    ).toBeNull();
  });

  it('does not fire on INSERT ... RETURNING *', () => {
    expect(
      fire("INSERT INTO users (email) VALUES ('a@b.com') RETURNING *"),
    ).toBeNull();
  });

  it('does not fire on UPDATE ... RETURNING', () => {
    expect(
      fire("UPDATE users SET email = 'x' WHERE id = 1 RETURNING id, email"),
    ).toBeNull();
  });

  it('does not fire on DELETE ... RETURNING', () => {
    expect(
      fire('DELETE FROM users WHERE id = 1 RETURNING id'),
    ).toBeNull();
  });

  it('does not fire on UPSERT with RETURNING on the outer INSERT', () => {
    expect(
      fire(
        "INSERT INTO users (id, email) VALUES (1, 'a@b.com') " +
          'ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email ' +
          'RETURNING id',
      ),
    ).toBeNull();
  });
});

describe('SQL-014 — does not fire on non-write statements', () => {
  it('does not fire on SELECT', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });

  it('does not fire on TRUNCATE (no RETURNING applicable)', () => {
    expect(fire('TRUNCATE users')).toBeNull();
  });

  it('does not fire on DROP TABLE', () => {
    expect(fire('DROP TABLE users')).toBeNull();
  });

  it('does not fire on CREATE TABLE', () => {
    expect(fire('CREATE TABLE users (id INT)')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-014 — edge cases', () => {
  it('fires on first qualifying stmt in a multi-statement script', () => {
    const c = fire(
      'SELECT 1; ' +
        "INSERT INTO users (email) VALUES ('a@b.com'); " +
        "UPDATE users SET email = 'x' WHERE id = 1 RETURNING id",
    );
    expect(c?.code).toBe('SQL-014');
    expect(c?.title).toContain('INSERT');
  });

  it('fires on second stmt when first has RETURNING', () => {
    const c = fire(
      "INSERT INTO a (x) VALUES (1) RETURNING id; " +
        "UPDATE b SET y = 2 WHERE id = 1",
    );
    expect(c?.code).toBe('SQL-014');
    expect(c?.title).toContain('UPDATE');
    expect(c?.detail).toContain('b');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_014(cursor)).not.toThrow();
    expect(SQL_014(cursor)).toBeNull();
  });

  it('handles malformed UpdateStmt (missing relation)', () => {
    const ast = {
      stmts: [
        {
          stmt: {
            UpdateStmt: {
              targetList: [],
              // no returningList, no relation
            },
          },
        },
      ],
    };
    const c = SQL_014(ast);
    expect(c?.code).toBe('SQL-014');
    expect(c?.detail).toContain('<unknown>');
  });

  it('treats empty returningList as missing (fires)', () => {
    const ast = {
      stmts: [
        {
          stmt: {
            UpdateStmt: {
              relation: { relname: 'users' },
              targetList: [],
              returningList: [], // explicit empty
            },
          },
        },
      ],
    };
    const c = SQL_014(ast);
    expect(c?.code).toBe('SQL-014');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-014 — output stability', () => {
  it('INSERT canonical case has stable shape and confidence 50', () => {
    const c = fire("INSERT INTO users (email) VALUES ('x')");
    expect(c).toMatchObject({
      code: 'SQL-014',
      title: 'INSERT without RETURNING',
      severity: 'info',
      confidence: 50,
      threatCategories: ['integrity'],
    });
    expect(typeof c?.detail).toBe('string');
    expect(typeof c?.fix).toBe('string');
  });

  it('UPDATE canonical case has stable shape', () => {
    const c = fire("UPDATE users SET email = 'x' WHERE id = 1");
    expect(c).toMatchObject({
      code: 'SQL-014',
      title: 'UPDATE without RETURNING',
      severity: 'info',
      confidence: 50,
    });
  });

  it('DELETE canonical case has stable shape', () => {
    const c = fire('DELETE FROM users WHERE id = 1');
    expect(c).toMatchObject({
      code: 'SQL-014',
      title: 'DELETE without RETURNING',
      severity: 'info',
      confidence: 50,
    });
  });
});
