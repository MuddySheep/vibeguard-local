import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_012 } from '../src/rules/sql-012-recursive-cte.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_012(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-012 — fires on unbounded recursive CTEs', () => {
  it('fires on bare WITH RECURSIVE r AS (... UNION ALL SELECT n+1 FROM r) (no WHERE)', () => {
    const c = fire(
      'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r) SELECT * FROM r',
    );
    expect(c?.code).toBe('SQL-012');
    expect(c?.severity).toBe('block');
    expect(c?.confidence).toBe(85);
    expect(c?.threatCategories).toContain('denial-of-service');
  });

  it('fires when the recursive WHERE compares two columns (no constant bound)', () => {
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS a, 1 AS b UNION ALL SELECT a+1, b*2 FROM r WHERE a < b) SELECT * FROM r',
      )?.code,
    ).toBe('SQL-012');
  });

  it('fires on tree-walk shape without depth bound', () => {
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT id FROM start UNION SELECT child_id FROM r JOIN tree ON tree.parent = r.id) SELECT * FROM r',
      )?.code,
    ).toBe('SQL-012');
  });

  it('fires when an outer LIMIT is the only bound (recursion itself is unbounded)', () => {
    // LIMIT on the outer SELECT bounds total returned rows but not
    // the recursion itself — recursion can still consume memory.
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r) SELECT * FROM r LIMIT 100',
      )?.code,
    ).toBe('SQL-012');
  });

  it('fires when WHERE has no comparison-against-constant', () => {
    expect(
      fire(
        "WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r WHERE n IS NOT NULL) SELECT * FROM r",
      )?.code,
    ).toBe('SQL-012');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-012 — does not fire on safe shapes', () => {
  it('does not fire on bounded recursive CTE (WHERE n < 100)', () => {
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r WHERE n < 100) SELECT * FROM r',
      ),
    ).toBeNull();
  });

  it('does not fire on bounded with <= literal', () => {
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r WHERE n <= 10) SELECT * FROM r',
      ),
    ).toBeNull();
  });

  it('does not fire on non-recursive CTE', () => {
    expect(
      fire('WITH r AS (SELECT 1) SELECT * FROM r'),
    ).toBeNull();
  });

  it('does not fire on plain SELECT (no WITH)', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });

  it('does not fire when WITH RECURSIVE is declared but no self-reference', () => {
    // The user wrote RECURSIVE but the CTE body doesn't actually
    // reference itself — no recursion happens.
    expect(
      fire('WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r'),
    ).toBeNull();
  });

  it('does not fire on UPDATE / DELETE (different stmt type, no WithClause)', () => {
    expect(fire('UPDATE users SET email=$1 WHERE id=1')).toBeNull();
    expect(fire('DELETE FROM users WHERE id=1')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-012 — edge cases', () => {
  it('fires once even when multiple unbounded recursive CTEs in one WITH', () => {
    expect(
      fire(
        'WITH RECURSIVE a AS (SELECT 1 AS x UNION ALL SELECT x+1 FROM a), b AS (SELECT 1 AS y UNION ALL SELECT y+1 FROM b) SELECT * FROM a, b',
      )?.code,
    ).toBe('SQL-012');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_012(cursor)).not.toThrow();
    expect(SQL_012(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_012(r.ast)).toBeNull();
  });

  it('handles bound predicate hidden inside AND boolean', () => {
    // The bound (`n < 100`) is OK even if combined with other conditions.
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS n, 1 AS m UNION ALL SELECT n+1, m+1 FROM r WHERE n < 100 AND m IS NOT NULL) SELECT * FROM r',
      ),
    ).toBeNull();
  });

  it('does not fire when bound is on the right side (e.g. `100 > n`)', () => {
    // Operator orientation shouldn't matter; bound is still a literal.
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r WHERE 100 > n) SELECT * FROM r',
      ),
    ).toBeNull();
  });

  it('fires when bound predicate compares two columns instead of a literal', () => {
    expect(
      fire(
        'WITH RECURSIVE r AS (SELECT 1 AS a, 100 AS b UNION ALL SELECT a+1, b-1 FROM r WHERE a < b) SELECT * FROM r',
      )?.code,
    ).toBe('SQL-012');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-012 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire(
      'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM r) SELECT * FROM r',
    );
    expect(c).toMatchObject({
      code: 'SQL-012',
      title: 'Recursive CTE without obvious termination',
      severity: 'block',
      confidence: 85,
      threatCategories: ['denial-of-service'],
    });
    expect(c?.detail).toContain('r');
    expect(c?.fix).toContain('depth');
  });
});
