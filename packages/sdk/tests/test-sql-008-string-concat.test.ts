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
// CASE 1 — runtime-injection shape (severity warn, confidence 85)
//
// Every query that fired SQL-008 in v1.5 still fires in v1.6. The
// (severity, confidence) pair shifted from (block, 90) to (warn, 85)
// per consumer feedback (documented in CHANGELOG 1.6.0). Fire-or-no-
// fire behavior on these queries is unchanged.
// ----------------------------------------------------------------------

describe('SQL-008 — CASE 1 (runtime): parameter-bearing string concat', () => {
  it("fires on `name = $1 || '%'` (LIKE-pattern construction)", () => {
    const c = fire("SELECT * FROM users WHERE name = $1 || '%'");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(85);
    expect(c?.threatCategories).toContain('injection');
  });

  it('fires on multi-segment concat in INSERT VALUES with params', () => {
    expect(
      fire(
        "INSERT INTO logs (msg) VALUES ('error: ' || $1 || ' from ' || $2)",
      )?.code,
    ).toBe('SQL-008');
  });

  it('fires on `$1 || $2` (param-only concat)', () => {
    expect(fire('SELECT $1 || $2 FROM users LIMIT 1')?.code).toBe(
      'SQL-008',
    );
  });

  it('fires on classic injection-shape comparison value', () => {
    expect(
      fire("SELECT * FROM users WHERE id = ('AND name=' || $1 || '')")?.code,
    ).toBe('SQL-008');
  });

  it('fires on UPDATE WHERE-clause with param-concat', () => {
    expect(
      fire(
        "UPDATE users SET active = false WHERE email = $1 || '@example.com'",
      )?.code,
    ).toBe('SQL-008');
  });

  it('fires on function-result + literal concat (still warn/85 in v1.6+)', () => {
    const c = fire("SELECT col || to_char(now(), 'YYYY-MM-DD') FROM t");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(85);
  });

  it('handles param on left side of concat', () => {
    expect(fire("SELECT $1 || ' suffix' FROM t LIMIT 1")?.code).toBe(
      'SQL-008',
    );
  });
});

// ----------------------------------------------------------------------
// CASE 2 — pure-literal injection-payload shape (info, 75)
// New in v1.6. Catches literal-concat queries whose literal text
// contains an injection-payload signature.
// ----------------------------------------------------------------------

describe('SQL-008 — CASE 2 (payload-shape): literal concat with payload signature', () => {
  it('fires info/75 on `\'admin\' || \' OR 1=1\'` (verbatim gallery sample)', () => {
    const sql = `SELECT * FROM users\nWHERE name = 'admin' || ' OR 1=1';`;
    const r = parseQuery(sql);
    expect(r.error).toBeUndefined();
    const c = SQL_008(r.ast);
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(75);
    expect(c?.threatCategories).toContain('injection');
  });

  // Battery query 1 (also the gallery sample) — covered above.

  // Battery query 3 — explicit tier assertion per the brief.
  it("fires info/75 on three-way literal concat with OR 1=1: `'a' || 'b' || ' OR 1=1'`", () => {
    const c = fire(
      "SELECT * FROM users WHERE name = 'a' || 'b' || ' OR 1=1';",
    );
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(75);
  });

  it('fires info/75 on `UNION` payload in literal concat', () => {
    const c = fire("SELECT 'x' || ' UNION SELECT password FROM users' FROM t");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(75);
  });

  it('fires info/75 on `--` comment-marker payload in literal concat', () => {
    const c = fire("SELECT 'name=' || 'admin'';--' FROM t");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(75);
  });

  it('fires info/75 on `; DROP TABLE` statement-terminator payload', () => {
    const c = fire("SELECT 'a' || '; DROP TABLE users' FROM t");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(75);
  });

  it("fires info/75 on quote-evasion payload `'' = ''`", () => {
    const c = fire("SELECT 'x' || ''' = ''' FROM t");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(75);
  });
});

// ----------------------------------------------------------------------
// CASE 3 — pure-literal benign concat (silent)
// User-specified examples from the brief that MUST stay silent.
// ----------------------------------------------------------------------

describe('SQL-008 — CASE 3 (benign literal): silent', () => {
  // Battery query 2.
  it("does not fire on `SELECT 'a' || 'b' AS x FROM users`", () => {
    expect(fire("SELECT 'a' || 'b' AS x FROM users;")).toBeNull();
  });

  // Battery query 4.
  it("does not fire on `'foo' || 'bar'`", () => {
    expect(
      fire("SELECT id FROM users WHERE x = 'foo' || 'bar';"),
    ).toBeNull();
  });

  // Battery query 5.
  it("does not fire on `'hello ' || ' world'`", () => {
    expect(
      fire(
        "UPDATE users SET note = 'hello ' || ' world' WHERE id = 1;",
      ),
    ).toBeNull();
  });

  it("does not fire on pure literal concat `'hello' || 'world'`", () => {
    expect(fire("SELECT 'hello' || 'world' FROM t")).toBeNull();
  });

  it('does not fire on three-way benign literal concat', () => {
    expect(fire("SELECT 'a' || 'b' || 'c' FROM t")).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Display concat — column refs + literals, no payload. Silent.
// ----------------------------------------------------------------------

describe('SQL-008 — display concat: silent', () => {
  it("does not fire on `first_name || ' ' || last_name` (permanent regression guard)", () => {
    expect(
      fire(
        'SELECT first_name || \' \' || last_name FROM users WHERE id = 42',
      ),
    ).toBeNull();
  });

  it("does not fire on `first || ' ' || last` aliased", () => {
    expect(
      fire("SELECT first || ' ' || last AS full FROM users"),
    ).toBeNull();
  });

  it('does not fire on column || column display concat', () => {
    expect(fire('SELECT first_name || last_name FROM users')).toBeNull();
  });

  it('does not fire on column-only concat (no params, no functions)', () => {
    expect(
      fire("SELECT a || b || c || ' suffix' FROM t"),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Array operands — silent regardless of tier.
// ----------------------------------------------------------------------

describe('SQL-008 — array concat: silent', () => {
  it('does not fire on `ARRAY[1,2] || ARRAY[3,4]`', () => {
    expect(fire('SELECT ARRAY[1,2] || ARRAY[3,4] FROM t')).toBeNull();
  });

  it("does not fire on `ARRAY['a'] || ARRAY['b','c']`", () => {
    expect(fire("SELECT ARRAY['a'] || ARRAY['b','c'] FROM t")).toBeNull();
  });
});

// ----------------------------------------------------------------------
// No-concat queries — silent.
// ----------------------------------------------------------------------

describe('SQL-008 — no concat: silent', () => {
  it('does not fire on no-concat queries', () => {
    expect(fire("SELECT * FROM users WHERE name = 'alice'")).toBeNull();
    expect(fire('SELECT * FROM users')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-008 — edge cases', () => {
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

  it('CASE 1 wins over CASE 2 when both could apply (param + payload literal)', () => {
    // Has a ParamRef → CASE 1 (warn, 85), even though the literal
    // contains an injection payload signature.
    const c = fire("SELECT * FROM users WHERE name = $1 || ' OR 1=1'");
    expect(c?.code).toBe('SQL-008');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(85);
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-008 — output stability', () => {
  it('canonical CASE 1 (param-concat) output shape locked', () => {
    const c = fire("SELECT * FROM t WHERE x = $1 || 'suffix'");
    expect(c).toMatchObject({
      code: 'SQL-008',
      title: 'Possible string-concatenation injection',
      severity: 'warn',
      confidence: 85,
      threatCategories: ['injection'],
    });
    expect(c?.fix).toContain('parameterized');
  });

  it('canonical CASE 2 (payload-shape) output shape locked', () => {
    const c = fire("SELECT 'admin' || ' OR 1=1' FROM t");
    expect(c).toMatchObject({
      code: 'SQL-008',
      title: 'Possible string-concatenation injection',
      severity: 'info',
      confidence: 75,
      threatCategories: ['injection'],
    });
  });
});
