import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_004 } from '../src/rules/sql-004-coercion.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_004(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-004 — fires on column-name + literal-type mismatches', () => {
  it('fires on `id = \'abc\'` (numeric-named column, string literal)', () => {
    const c = fire("SELECT * FROM users WHERE id = 'abc'");
    expect(c?.code).toBe('SQL-004');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(75);
    expect(c?.threatCategories).toContain('corruption');
  });

  it('fires on `user_id = \'foo\'` (suffix-numeric column)', () => {
    expect(fire("SELECT * FROM t WHERE user_id = 'foo'")?.code).toBe(
      'SQL-004',
    );
  });

  it('fires on `total_count > \'10\'` (numeric column compared to quoted-numeric)', () => {
    // Even quoted-numeric on a numeric column is a coercion bug shape.
    expect(fire("SELECT * FROM t WHERE total_count > '10'")?.code).toBe(
      'SQL-004',
    );
  });

  it('fires on `amount = \'many\'` (numeric column, text literal)', () => {
    expect(fire("SELECT * FROM t WHERE amount = 'many'")?.code).toBe(
      'SQL-004',
    );
  });

  it('fires on `name = 123` (text column, integer literal)', () => {
    expect(fire('SELECT * FROM users WHERE name = 123')?.code).toBe(
      'SQL-004',
    );
  });

  it('fires on `email = 4.5` (text column, float literal)', () => {
    expect(fire('SELECT * FROM users WHERE email = 4.5')?.code).toBe(
      'SQL-004',
    );
  });

  it('fires regardless of operand order (`123 = name`)', () => {
    expect(fire('SELECT * FROM users WHERE 123 = name')?.code).toBe(
      'SQL-004',
    );
  });

  it('fires when nested inside boolean expressions', () => {
    expect(
      fire(
        "SELECT * FROM t WHERE active = true AND id = 'oops'",
      )?.code,
    ).toBe('SQL-004');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-004 — does not fire on safe shapes', () => {
  it('does not fire on `id = 123` (matched types)', () => {
    expect(fire('SELECT * FROM users WHERE id = 123')).toBeNull();
  });

  it("does not fire on `name = 'alice'` (matched types)", () => {
    expect(fire("SELECT * FROM users WHERE name = 'alice'")).toBeNull();
  });

  it("does not fire on explicit cast `id = '123'::int`", () => {
    expect(
      fire("SELECT * FROM users WHERE id = '123'::int"),
    ).toBeNull();
  });

  it('does not fire on parameterized comparison `id = $1`', () => {
    expect(fire('SELECT * FROM users WHERE id = $1')).toBeNull();
  });

  it('does not fire on function-result comparison `id = max(other_id)`', () => {
    expect(
      fire('SELECT * FROM users WHERE id = (SELECT max(id) FROM other)'),
    ).toBeNull();
  });

  it('does not fire on column-vs-column comparisons', () => {
    expect(
      fire('SELECT * FROM users u JOIN orders o ON u.id = o.user_id'),
    ).toBeNull();
  });

  it('does not fire on unclassified column names', () => {
    // `meta` doesn't match any of our heuristic suffixes / names.
    expect(
      fire("SELECT * FROM t WHERE meta = 'anything'"),
    ).toBeNull();
  });

  it('does not fire on NULL literal (SQL-005 territory)', () => {
    expect(fire('SELECT * FROM t WHERE id = NULL')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-004 — edge cases', () => {
  it('fires once even when multiple mismatches in same query', () => {
    expect(
      fire("SELECT * FROM t WHERE id = 'a' AND user_id = 'b'")?.code,
    ).toBe('SQL-004');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_004(cursor)).not.toThrow();
    expect(SQL_004(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_004(r.ast)).toBeNull();
  });

  it('respects qualified column names (last field is the column)', () => {
    // u.id is a qualified ref — last field 'id' matches numeric.
    expect(
      fire("SELECT * FROM users u WHERE u.id = 'abc'")?.code,
    ).toBe('SQL-004');
  });

  it('fires on UPDATE / DELETE WHERE coercion', () => {
    expect(
      fire("UPDATE users SET email = $1 WHERE id = 'x'")?.code,
    ).toBe('SQL-004');
    expect(
      fire("DELETE FROM users WHERE id = 'x'")?.code,
    ).toBe('SQL-004');
  });

  it('does not fire on date-named columns (out of scope in v1)', () => {
    // `created_at` is a date suffix; date-vs-string detection is
    // intentionally skipped in v1 because most legitimate uses are
    // ISO-shaped strings. Documented limitation.
    expect(
      fire("SELECT * FROM t WHERE created_at = '2024-01-01'"),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-004 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire("SELECT * FROM users WHERE id = 'abc'");
    expect(c).toMatchObject({
      code: 'SQL-004',
      title: 'Likely implicit type coercion in comparison',
      severity: 'warn',
      confidence: 75,
      threatCategories: ['corruption'],
    });
    expect(c?.detail).toContain('id');
    expect(c?.fix.length).toBeGreaterThan(20);
  });
});
