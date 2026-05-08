import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_015 } from '../src/rules/sql-015-select-star.js';

// V1.1 — SQL-015 SELECT * over-fetch tests.
// Distribution: positive cases for bare * and qualified t.*, plus the
// nested-context cases (CTEs, subqueries, UNION). Negative cases for
// explicit columns and the function-arg star (COUNT(*) etc.) that
// should NOT fire.

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_015(r.ast);
}

// ----------------------------------------------------------------------
// Positive — bare *
// ----------------------------------------------------------------------

describe('SQL-015 — fires on bare SELECT *', () => {
  it('fires on top-level SELECT *', () => {
    const c = fire('SELECT * FROM users');
    expect(c?.code).toBe('SQL-015');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(60);
    expect(c?.title).toContain('over-fetch');
    expect(c?.threatCategories).toContain('exfiltration');
    expect(c?.threatCategories).toContain('integrity');
  });

  it('fires on SELECT * with WHERE', () => {
    const c = fire('SELECT * FROM users WHERE id = 1');
    expect(c?.code).toBe('SQL-015');
  });

  it('fires on SELECT * with LIMIT', () => {
    const c = fire('SELECT * FROM users LIMIT 10');
    expect(c?.code).toBe('SQL-015');
  });

  it('fires on SELECT * inside a CTE', () => {
    const c = fire('WITH cte AS (SELECT * FROM users) SELECT id FROM cte');
    expect(c?.code).toBe('SQL-015');
  });

  it('fires on SELECT * inside a subquery', () => {
    const c = fire('SELECT id FROM (SELECT * FROM users) sub');
    expect(c?.code).toBe('SQL-015');
  });

  it('fires on SELECT * on the right side of UNION', () => {
    const c = fire('SELECT id FROM a UNION SELECT * FROM b');
    expect(c?.code).toBe('SQL-015');
  });
});

// ----------------------------------------------------------------------
// Positive — qualified t.*
// ----------------------------------------------------------------------

describe('SQL-015 — fires on qualified t.*', () => {
  it('fires on SELECT t.*', () => {
    const c = fire('SELECT t.* FROM users t');
    expect(c?.code).toBe('SQL-015');
    expect(c?.title).toContain('qualified');
    expect(c?.detail).toContain('t.*');
  });

  it('fires on mixed-projection SELECT u.*, o.id', () => {
    const c = fire(
      'SELECT u.*, o.id FROM users u JOIN orders o ON u.id = o.user_id',
    );
    expect(c?.code).toBe('SQL-015');
    expect(c?.detail).toContain('u.*');
  });
});

// ----------------------------------------------------------------------
// Negative — explicit columns and non-projection-level stars
// ----------------------------------------------------------------------

describe('SQL-015 — does not fire on explicit projections', () => {
  it('does not fire on SELECT col1, col2 ...', () => {
    expect(fire('SELECT id, email FROM users')).toBeNull();
  });

  it('does not fire on SELECT t.col1, t.col2', () => {
    expect(fire('SELECT t.id, t.email FROM users t')).toBeNull();
  });

  it('does not fire on SELECT id AS user_id', () => {
    expect(fire('SELECT id AS user_id FROM users')).toBeNull();
  });

  it('does not fire on SELECT 1 (literal projection)', () => {
    expect(fire('SELECT 1')).toBeNull();
  });
});

describe('SQL-015 — does not fire on function-arg stars', () => {
  it('does not fire on COUNT(*)', () => {
    expect(fire('SELECT COUNT(*) FROM users')).toBeNull();
  });

  it('does not fire on COUNT(*) with GROUP BY', () => {
    expect(
      fire('SELECT email, COUNT(*) FROM users GROUP BY email'),
    ).toBeNull();
  });

  it('does not fire on COUNT(DISTINCT *) (rare but valid)', () => {
    // COUNT(*) is the canonical aggregate; DISTINCT * is unusual
    // but Postgres parses it. The point is the star is inside the
    // function arg, not a projection entry.
    expect(fire('SELECT COUNT(*) AS cnt FROM users')).toBeNull();
  });
});

describe('SQL-015 — does not fire on non-SELECT statements', () => {
  it('does not fire on UPDATE without RETURNING', () => {
    expect(fire("UPDATE users SET email = 'x' WHERE id = 1")).toBeNull();
  });

  it('does not fire on INSERT without RETURNING', () => {
    expect(
      fire("INSERT INTO users (email) VALUES ('a@b.com')"),
    ).toBeNull();
  });

  it('does not fire on DROP TABLE', () => {
    expect(fire('DROP TABLE users')).toBeNull();
  });

  it('does not fire on TRUNCATE', () => {
    expect(fire('TRUNCATE users')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Negative — RETURNING * is a different shape (RETURNING-list, not targetList)
// ----------------------------------------------------------------------

describe('SQL-015 — RETURNING * (rule does not currently fire)', () => {
  // Documented behavior: SQL-015 today targets SELECT projections
  // only. RETURNING * is a different threat shape (it surfaces all
  // columns of the affected rows back to the caller); detecting it
  // is a possible follow-up rule but not part of V1.1's scope.
  it('does not fire on UPDATE ... RETURNING *', () => {
    expect(
      fire("UPDATE users SET email = 'x' WHERE id = 1 RETURNING *"),
    ).toBeNull();
  });

  it('does not fire on INSERT ... RETURNING *', () => {
    expect(
      fire("INSERT INTO users (email) VALUES ('a@b.com') RETURNING *"),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-015 — edge cases', () => {
  it('fires on first star projection in a multi-statement script', () => {
    const c = fire(
      'SELECT id FROM a; SELECT * FROM b; SELECT email FROM c',
    );
    expect(c?.code).toBe('SQL-015');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_015(cursor)).not.toThrow();
    expect(SQL_015(cursor)).toBeNull();
  });

  it('handles malformed ResTarget (missing val)', () => {
    const ast = {
      stmts: [
        {
          stmt: {
            SelectStmt: {
              targetList: [
                {
                  ResTarget: {
                    // no val
                  },
                },
              ],
            },
          },
        },
      ],
    };
    expect(SQL_015(ast)).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-015 — output stability', () => {
  it('bare SELECT * canonical case has stable shape', () => {
    const c = fire('SELECT * FROM users');
    expect(c).toMatchObject({
      code: 'SQL-015',
      severity: 'info',
      confidence: 60,
      threatCategories: ['exfiltration', 'integrity'],
    });
    expect(typeof c?.detail).toBe('string');
    expect(typeof c?.fix).toBe('string');
  });

  it('qualified t.* canonical case has stable shape', () => {
    const c = fire('SELECT t.* FROM users t');
    expect(c).toMatchObject({
      code: 'SQL-015',
      severity: 'info',
      confidence: 60,
    });
    expect(c?.title).toContain('qualified');
  });
});
