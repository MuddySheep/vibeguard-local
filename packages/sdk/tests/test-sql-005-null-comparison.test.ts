import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_005 } from '../src/rules/sql-005-null-comparison.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_005(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-005 — fires on `=` / `<>` with NULL literal', () => {
  it('fires on WHERE col = NULL', () => {
    const c = fire('SELECT * FROM t WHERE x = NULL');
    expect(c?.code).toBe('SQL-005');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(95);
    expect(c?.threatCategories).toContain('corruption');
  });

  it('fires on WHERE col != NULL (parser normalizes to <>)', () => {
    expect(fire('SELECT * FROM t WHERE x != NULL')?.code).toBe('SQL-005');
  });

  it('fires on WHERE col <> NULL', () => {
    expect(fire('SELECT * FROM t WHERE x <> NULL')?.code).toBe('SQL-005');
  });

  it('fires on NULL on left side: NULL = col', () => {
    expect(fire('SELECT * FROM t WHERE NULL = x')?.code).toBe('SQL-005');
  });

  it('fires inside HAVING clause', () => {
    expect(
      fire('SELECT count(*) FROM t HAVING max(x) = NULL')?.code,
    ).toBe('SQL-005');
  });

  it('fires inside CASE WHEN', () => {
    expect(
      fire(
        "SELECT CASE WHEN col = NULL THEN 1 ELSE 0 END AS bug FROM t",
      )?.code,
    ).toBe('SQL-005');
  });

  it('fires when function-result is the non-null operand: coalesce(col,1) = NULL', () => {
    // The footgun is the direct =NULL comparison, regardless of how
    // the other operand was computed.
    expect(
      fire("SELECT * FROM t WHERE coalesce(col, '') = NULL")?.code,
    ).toBe('SQL-005');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-005 — does not fire on correct NULL handling', () => {
  it('does not fire on IS NULL', () => {
    expect(fire('SELECT * FROM t WHERE x IS NULL')).toBeNull();
  });

  it('does not fire on IS NOT NULL', () => {
    expect(fire('SELECT * FROM t WHERE x IS NOT NULL')).toBeNull();
  });

  it('does not fire on IS DISTINCT FROM NULL', () => {
    expect(fire('SELECT * FROM t WHERE x IS DISTINCT FROM NULL')).toBeNull();
  });

  it('does not fire on IS NOT DISTINCT FROM NULL', () => {
    expect(
      fire('SELECT * FROM t WHERE x IS NOT DISTINCT FROM NULL'),
    ).toBeNull();
  });

  it('does not fire on regular comparisons without NULL', () => {
    expect(fire('SELECT * FROM t WHERE x = 1')).toBeNull();
    expect(fire("SELECT * FROM t WHERE x = 'hello'")).toBeNull();
    expect(fire('SELECT * FROM t WHERE x = y')).toBeNull();
  });

  it('does not fire on NULLIF (NULL is a function arg, not direct comparison)', () => {
    expect(
      fire("SELECT * FROM t WHERE NULLIF(x, 'sentinel') = 'y'"),
    ).toBeNull();
  });

  it('does not fire on COALESCE without =NULL', () => {
    expect(
      fire("SELECT * FROM t WHERE coalesce(x, 'default') = 'hello'"),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-005 — edge cases', () => {
  it('fires once even when multiple =NULL appear (single-catch contract)', () => {
    const c = fire('SELECT * FROM t WHERE a = NULL OR b = NULL');
    expect(c?.code).toBe('SQL-005');
  });

  it('does not fire on empty / whitespace SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_005(r.ast)).toBeNull();
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_005(cursor)).not.toThrow();
    expect(SQL_005(cursor)).toBeNull();
  });

  it('fires on UPDATE WHERE col = NULL', () => {
    expect(
      fire('UPDATE t SET y = 1 WHERE x = NULL')?.code,
    ).toBe('SQL-005');
  });

  it('fires on DELETE WHERE col = NULL', () => {
    expect(fire('DELETE FROM t WHERE x = NULL')?.code).toBe('SQL-005');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-005 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire('SELECT * FROM users WHERE email = NULL');
    expect(c).toMatchObject({
      code: 'SQL-005',
      title: 'NULL comparison with `=` / `<>`',
      severity: 'warn',
      confidence: 95,
      threatCategories: ['corruption'],
    });
    expect(c?.detail).toContain('three-valued logic');
    expect(c?.fix).toContain('IS NULL');
  });
});
