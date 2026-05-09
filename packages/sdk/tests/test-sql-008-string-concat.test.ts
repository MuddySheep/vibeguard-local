import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_008 } from '../src/rules/sql-008-string-concat.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_008(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-008 — fires on parameter-bearing string concat', () => {
  it("fires on `name = $1 || '%'` (LIKE-pattern construction)", () => {
    const c = fire("SELECT * FROM users WHERE name = $1 || '%'");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('block');
    expect(c?.confidence).toBe(90);
    expect(c?.threatCategories).toContain('injection');
  });

  it("fires on multi-segment concat in INSERT VALUES with params", () => {
    expect(
      fire(
        "INSERT INTO logs (msg) VALUES ('error: ' || $1 || ' from ' || $2)",
      )?.code,
    ).toBe('SQL-008');
  });

  it("fires on `$1 || $2` (param-only concat)", () => {
    expect(fire('SELECT $1 || $2 FROM users LIMIT 1')?.code).toBe(
      'SQL-008',
    );
  });

  it("fires on classic injection-shape comparison value", () => {
    expect(
      fire(
        "SELECT * FROM users WHERE id = ('AND name=' || $1 || '')",
      )?.code,
    ).toBe('SQL-008');
  });

  it("fires on UPDATE WHERE-clause with param-concat", () => {
    expect(
      fire(
        "UPDATE users SET active = false WHERE email = $1 || '@example.com'",
      )?.code,
    ).toBe('SQL-008');
  });

  it('fires on function-result + literal concat at confidence 80', () => {
    const c = fire("SELECT col || to_char(now(), 'YYYY-MM-DD') FROM t");
    expect(c?.code).toBe('SQL-008');
    expect(c?.confidence).toBe(80);
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-008 — does not fire on safe concat shapes', () => {
  it("does not fire on display concat `first || ' ' || last`", () => {
    expect(
      fire("SELECT first || ' ' || last AS full FROM users"),
    ).toBeNull();
  });

  it("does not fire on pure literal concat `'a' || 'b'`", () => {
    expect(fire("SELECT 'hello' || 'world' FROM t")).toBeNull();
  });

  it('does not fire on three-way literal concat', () => {
    expect(fire("SELECT 'a' || 'b' || 'c' FROM t")).toBeNull();
  });

  it('does not fire on array concat `ARRAY[1,2] || ARRAY[3,4]`', () => {
    expect(fire('SELECT ARRAY[1,2] || ARRAY[3,4] FROM t')).toBeNull();
  });

  it('does not fire on column || column display concat', () => {
    expect(fire('SELECT first_name || last_name FROM users')).toBeNull();
  });

  it('does not fire on no-concat queries', () => {
    expect(fire("SELECT * FROM users WHERE name = 'alice'")).toBeNull();
    expect(fire('SELECT * FROM users')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-008 — edge cases', () => {
  it('does not fire on column-only concat (no params, no functions)', () => {
    expect(
      fire("SELECT a || b || c || ' suffix' FROM t"),
    ).toBeNull();
  });

  it('fires once when multiple concats present (single-fire contract)', () => {
    expect(
      fire(
        "SELECT * FROM users WHERE name = $1 || '%' AND email = $2 || '@x'",
      )?.code,
    ).toBe('SQL-008');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_008(cursor)).not.toThrow();
    expect(SQL_008(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_008(r.ast)).toBeNull();
  });

  it('handles param on left side of concat', () => {
    expect(fire("SELECT $1 || ' suffix' FROM t LIMIT 1")?.code).toBe(
      'SQL-008',
    );
  });

  it("does not fire on array concat with literals (`'a' || ARRAY['b']` shape suppresses)", () => {
    // Mixed array + literal concat would be invalid SQL in practice,
    // but the rule should NOT fire because of the array-operand guard.
    expect(fire("SELECT ARRAY['a'] || ARRAY['b','c'] FROM t")).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-008 — output stability', () => {
  it('canonical param-concat case shape locked', () => {
    const c = fire("SELECT * FROM t WHERE x = $1 || 'suffix'");
    expect(c).toMatchObject({
      code: 'SQL-008',
      title: 'Possible string-concatenation injection',
      severity: 'block',
      confidence: 90,
      threatCategories: ['injection'],
    });
    expect(c?.fix).toContain('parameterized');
  });
});

  describe('SQL-008 — gallery sample regression pin', () => {
    // The playground gallery's SQL-008 sample, pinned VERBATIM here so
    // any future rule refactor that breaks the gallery sample fails CI
    // immediately. Mirrors apps/playground/tests/test-samples-fire.test.ts
    // but at the SDK layer for fast iteration.
    it('fires on the playground SQL-008 gallery sample', () => {
      const sql = `SELECT * FROM users\nWHERE name = $1 || ' OR 1=1';`;
      const r = parseQuery(sql);
      expect(r.error).toBeUndefined();
      const c = SQL_008(r.ast!);
      expect(c).not.toBeNull();
      expect(c!.code).toBe('SQL-008');
      expect(c!.confidence).toBe(90);
    });
  });
