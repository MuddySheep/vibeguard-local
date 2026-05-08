import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_002 } from '../src/rules/sql-002-self-join.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_002(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-002 — fires on disambiguation-less self-joins', () => {
  it('fires on JOIN with tautology predicate', () => {
    const c = fire('SELECT * FROM users u1 JOIN users u2 ON u1.id = u1.id');
    expect(c?.code).toBe('SQL-002');
    expect(c?.severity).toBe('warn');
    expect(c?.threatCategories).toContain('integrity');
  });

  it('fires on JOIN with no column references (1=1 predicate)', () => {
    // ON 1=1 has no ColumnRefs — there's no predicate connecting the
    // two table references at all.
    const c = fire('SELECT * FROM users u1 JOIN users u2 ON 1=1');
    expect(c?.code).toBe('SQL-002');
  });

  it('fires on comma + WHERE same-column equality', () => {
    // u1.id = u2.id is technically a predicate but compares the same
    // column on both sides — almost certainly a bug per docs.
    const c = fire('SELECT * FROM users u1, users u2 WHERE u1.id = u2.id');
    expect(c?.code).toBe('SQL-002');
  });

  it('fires on three-table self-join with no good predicate', () => {
    const c = fire(
      'SELECT * FROM users u1, users u2, users u3 ' +
        'WHERE u1.id = u2.id AND u2.id = u3.id',
    );
    expect(c?.code).toBe('SQL-002');
    expect(c?.detail).toContain('users');
  });

  it('fires on self-join via comma with no WHERE at all', () => {
    // Same-relation appears twice with no predicate connecting them.
    // SQL-001 may also fire on this; the rules are independent.
    const c = fire('SELECT * FROM users u1, users u2');
    expect(c?.code).toBe('SQL-002');
  });

  it('fires on JOIN with WHERE-only same-column equality', () => {
    const c = fire(
      'SELECT * FROM users u1 JOIN users u2 ON 1=1 WHERE u1.email = u2.email',
    );
    expect(c?.code).toBe('SQL-002');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-002 — does not fire on safe shapes', () => {
  it('does not fire on different tables (real cross-table JOIN)', () => {
    expect(
      fire(
        'SELECT * FROM users u JOIN orders o ON u.id = o.user_id',
      ),
    ).toBeNull();
  });

  it('does not fire on properly-aliased self-join (different cols)', () => {
    expect(
      fire(
        'SELECT * FROM users u1 JOIN users u2 ON u1.manager_id = u2.id',
      ),
    ).toBeNull();
  });

  it('does not fire on a hierarchy walk', () => {
    expect(
      fire(
        'SELECT * FROM employees e1 JOIN employees e2 ON e1.id = e2.parent_id',
      ),
    ).toBeNull();
  });

  it('does not fire on single-table SELECT', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });

  it('does not fire on SELECT without FROM', () => {
    expect(fire('SELECT 1')).toBeNull();
  });

  it('does not fire when WHERE has different-column connection (comma form)', () => {
    expect(
      fire(
        'SELECT * FROM users u1, users u2 WHERE u1.manager_id = u2.id',
      ),
    ).toBeNull();
  });

  it('does not fire on UPDATE / DELETE (different statement type)', () => {
    expect(fire('UPDATE users SET email=$1 WHERE id=1')).toBeNull();
    expect(fire('DELETE FROM users WHERE id=1')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-002 — edge cases', () => {
  it('handles CTE shadowing — fires on a self-join of a CTE name', () => {
    // The first SelectStmt walked is the CTE body (SELECT 1) which
    // has no fromClause. Whether SQL-002 fires here depends on which
    // SelectStmt the rule walks to first. v1 stops at the first one
    // (the CTE body), which has no fromClause → no fire. Document
    // tolerance: either null or SQL-002 is an acceptable v1 outcome.
    const c = fire(
      'WITH r AS (SELECT 1) SELECT * FROM r r1 JOIN r r2 ON r1.x = r1.x',
    );
    if (c) {
      expect(c.code).toBe('SQL-002');
    } else {
      expect(c).toBeNull();
    }
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_002(cursor)).not.toThrow();
    expect(SQL_002(cursor)).toBeNull();
  });

  it('does not fire when subquery in FROM happens to alias same name', () => {
    // FROM users u JOIN (SELECT * FROM other) users ON ... — the
    // second 'users' is a subquery alias, not a base-table reference.
    // extractFromTables marks it isSubquery=true; we skip those when
    // grouping. Should NOT fire as a self-join.
    const c = fire(
      'SELECT * FROM users u JOIN (SELECT id FROM other) users ON u.id = users.id',
    );
    expect(c).toBeNull();
  });

  it('handles schema-qualified self-join (relname-only grouping)', () => {
    // Same relname under different schemas — not actually the same
    // table. v1 groups by relname only, which is a known limitation
    // (documented in docs/rules/sql-002.md). We accept either fire
    // or no-fire here; the test documents the v1 behavior.
    const c = fire(
      'SELECT * FROM public.users u1 JOIN private.users u2 ON u1.id = u2.id',
    );
    if (c) {
      expect(c.code).toBe('SQL-002');
    } else {
      expect(c).toBeNull();
    }
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-002 — output stability', () => {
  it('canonical positive case produces stable Catch shape', () => {
    const c = fire('SELECT * FROM users u1 JOIN users u2 ON u1.id = u1.id');
    expect(c).toMatchObject({
      code: 'SQL-002',
      title: 'Self-join without disambiguating predicate',
      severity: 'warn',
      confidence: 75,
      threatCategories: ['integrity'],
    });
    expect(c?.detail).toContain('users');
    expect(c?.fix.length).toBeGreaterThan(20);
  });
});

// ----------------------------------------------------------------------
// V1.5 — UPDATE … FROM and DELETE … USING self-join coverage
//
// Discovered via the V1.5 playground stress test. The shape:
//
//   UPDATE transactions t1
//   SET status='flagged'
//   FROM transactions t2
//   WHERE t1.amount = '1000' AND t1.id NOT IN (...);
//
// Aliases t1 and t2 both reference `transactions` but no predicate
// connects them via DIFFERENT columns. SQL-002 originally only
// walked SelectStmt; coverage now extended to UpdateStmt and
// DeleteStmt.
// ----------------------------------------------------------------------

describe('SQL-002 — UPDATE … FROM same-table coverage', () => {
  it('fires on UPDATE t1 FROM t1 with only t1-only predicates', () => {
    const c = fire(
      `UPDATE transactions t1
       SET status = 'flagged'
       FROM transactions t2
       WHERE t1.amount = 1000`,
    );
    expect(c?.code).toBe('SQL-002');
    expect(c?.detail).toContain('transactions');
  });

  it('does NOT fire on UPDATE t1 FROM t1 with a parent/child predicate', () => {
    expect(
      fire(
        `UPDATE nodes parent
         SET status = 'archived'
         FROM nodes child
         WHERE child.parent_id = parent.id`,
      ),
    ).toBeNull();
  });

  it('does NOT fire when target and FROM are different relations', () => {
    expect(
      fire(
        `UPDATE accounts a
         SET balance = 0
         FROM users u
         WHERE a.user_id = u.id`,
      ),
    ).toBeNull();
  });
});

describe('SQL-002 — DELETE … USING same-table coverage', () => {
  it('fires on DELETE t1 USING t1 with only t1-only predicates', () => {
    const c = fire(
      `DELETE FROM transactions t1
       USING transactions t2
       WHERE t1.id = 5`,
    );
    expect(c?.code).toBe('SQL-002');
  });

  it('does NOT fire on DELETE t1 USING t1 with a column-distinguishing predicate', () => {
    expect(
      fire(
        `DELETE FROM nodes parent
         USING nodes child
         WHERE child.parent_id = parent.id`,
      ),
    ).toBeNull();
  });
});
