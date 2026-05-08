import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/index.js';
import { SQL_001, SQL_001_FIX } from '../src/rules/sql-001-cartesian.js';
import { SQL_005, SQL_005_FIX } from '../src/rules/sql-005-null-comparison.js';
import { SQL_006, SQL_006_FIX } from '../src/rules/sql-006-offset-without-orderby.js';
import { SQL_011, SQL_011_FIX } from '../src/rules/sql-011-aggregate-no-groupby.js';

// V1.3 — per-fixer unit tests.
//
// Each fixer is tested in isolation against the rule that owns it.
// We verify three properties per fixer:
//   1. When the rule fires on the input, the fixer returns a
//      different string (a real fix, not a no-op).
//   2. When the rule does NOT fire on the input, the fixer returns
//      null (no work to do).
//   3. The fixer's output parses cleanly (no broken SQL).
//   4. After applying the fix, the rule no longer fires (the catch
//      is genuinely resolved, not just papered over). Note: SQL-001
//      after a placeholder fix may technically still be cartesian,
//      but the JoinExpr suppresses the rule — that's documented
//      placeholder behavior.

beforeAll(async () => {
  await init();
});

function parseAndFix(
  rule: typeof SQL_005,
  fixer: { fix: (ast: unknown, sql: string) => string | null },
  sql: string,
): { fired: boolean; fixed: string | null; reFired: boolean } {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  const fired = rule(r.ast) !== null;
  const fixed = fixer.fix(r.ast, sql);
  let reFired = false;
  if (fixed !== null) {
    const r2 = parseQuery(fixed);
    if (r2.error === undefined) {
      reFired = rule(r2.ast) !== null;
    }
  }
  return { fired, fixed, reFired };
}

// ----------------------------------------------------------------------
// SQL-005
// ----------------------------------------------------------------------

describe('SQL_005_FIX — = NULL → IS NULL', () => {
  it('fixes WHERE col = NULL', () => {
    const r = parseAndFix(SQL_005, SQL_005_FIX, 'SELECT * FROM t WHERE x = NULL');
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('x IS NULL');
    expect(r.fixed).not.toContain('= NULL');
    expect(r.reFired).toBe(false);
  });

  it('fixes WHERE col <> NULL with IS NOT NULL', () => {
    const r = parseAndFix(SQL_005, SQL_005_FIX, 'SELECT * FROM t WHERE x <> NULL');
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('x IS NOT NULL');
    expect(r.reFired).toBe(false);
  });

  it('fixes WHERE col != NULL with IS NOT NULL', () => {
    const r = parseAndFix(SQL_005, SQL_005_FIX, 'SELECT * FROM t WHERE x != NULL');
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('x IS NOT NULL');
    expect(r.reFired).toBe(false);
  });

  it('fixes qualified name (t.col = NULL)', () => {
    const r = parseAndFix(SQL_005, SQL_005_FIX, 'SELECT * FROM t WHERE t.x = NULL');
    expect(r.fixed).toContain('t.x IS NULL');
  });

  it('returns null when there is no NULL comparison', () => {
    const r = parseAndFix(SQL_005, SQL_005_FIX, 'SELECT * FROM t WHERE x IS NULL');
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });

  it('does not edit text inside string literals', () => {
    const r = parseAndFix(
      SQL_005,
      SQL_005_FIX,
      "SELECT * FROM t WHERE comment = '= NULL' AND x = NULL",
    );
    expect(r.fired).toBe(true);
    // Real `= NULL` outside the literal got fixed.
    expect(r.fixed).toContain('x IS NULL');
    // Literal contents unchanged.
    expect(r.fixed).toContain("'= NULL'");
  });

  it('fixes only the FIRST occurrence (single-fix-per-call)', () => {
    const r = parseAndFix(
      SQL_005,
      SQL_005_FIX,
      'SELECT * FROM t WHERE a = NULL AND b = NULL',
    );
    expect(r.fixed).toContain('a IS NULL');
    // Second occurrence still present — runner picks it up next iter.
    expect(r.fixed).toContain('b = NULL');
  });
});

// ----------------------------------------------------------------------
// SQL-006
// ----------------------------------------------------------------------

describe('SQL_006_FIX — insert ORDER BY 1 before LIMIT/OFFSET', () => {
  it('inserts ORDER BY 1 before OFFSET', () => {
    const r = parseAndFix(SQL_006, SQL_006_FIX, 'SELECT id FROM t LIMIT 10 OFFSET 20');
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('ORDER BY 1 LIMIT');
    expect(r.reFired).toBe(false);
  });

  it('inserts ORDER BY 1 even with bare OFFSET (no LIMIT)', () => {
    const r = parseAndFix(SQL_006, SQL_006_FIX, 'SELECT id FROM t OFFSET 20');
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('ORDER BY 1 OFFSET');
  });

  it('returns null when ORDER BY is already present', () => {
    const r = parseAndFix(
      SQL_006,
      SQL_006_FIX,
      'SELECT id FROM t ORDER BY id LIMIT 10 OFFSET 20',
    );
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });

  it('returns null when there is no LIMIT/OFFSET', () => {
    const r = parseAndFix(SQL_006, SQL_006_FIX, 'SELECT id FROM t');
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });
});

// ----------------------------------------------------------------------
// SQL-001
// ----------------------------------------------------------------------

describe('SQL_001_FIX — FROM a, b → FROM a JOIN b ON TRUE /* TODO */', () => {
  it('converts a 2-table cartesian into an explicit JOIN ON TRUE', () => {
    const r = parseAndFix(
      SQL_001,
      SQL_001_FIX,
      'SELECT a.id, b.id FROM a, b WHERE x = 1',
    );
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('FROM a JOIN b ON TRUE');
    expect(r.fixed).toContain('TODO(vibeguard SQL-001)');
    expect(r.reFired).toBe(false); // JoinExpr present → rule suppresses
  });

  it('preserves table aliases (users u, orders o)', () => {
    const r = parseAndFix(
      SQL_001,
      SQL_001_FIX,
      'SELECT a.id, b.id FROM users u, orders o',
    );
    expect(r.fixed).toContain('users u JOIN orders o');
  });

  it('preserves schema-qualified names (public.a, schema2.b)', () => {
    const r = parseAndFix(
      SQL_001,
      SQL_001_FIX,
      'SELECT a.id, b.id FROM public.a, schema2.b',
    );
    expect(r.fixed).toContain('public.a JOIN schema2.b');
  });

  it('does NOT swallow trailing SQL keywords as aliases', () => {
    const r = parseAndFix(
      SQL_001,
      SQL_001_FIX,
      'SELECT a.id, b.id FROM a, b WHERE x = 1',
    );
    // The trailing WHERE must stay as WHERE, not be consumed as an alias.
    expect(r.fixed).toContain('WHERE x = 1');
    expect(r.fixed).not.toContain('JOIN b WHERE');
  });

  it('returns null when an explicit JOIN already exists', () => {
    const r = parseAndFix(
      SQL_001,
      SQL_001_FIX,
      'SELECT a.id, b.id FROM a JOIN b ON a.x = b.y',
    );
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });

  it('returns null when there is only one FROM table', () => {
    const r = parseAndFix(SQL_001, SQL_001_FIX, 'SELECT id FROM t');
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });

  it('produces parseable SQL', () => {
    const r = parseAndFix(SQL_001, SQL_001_FIX, 'SELECT * FROM a, b');
    expect(r.fixed).not.toBeNull();
    const r2 = parseQuery(r.fixed!);
    expect(r2.error).toBeUndefined();
  });
});

// ----------------------------------------------------------------------
// SQL-011
// ----------------------------------------------------------------------

describe('SQL_011_FIX — add missing GROUP BY column', () => {
  it('adds GROUP BY to a simple aggregate-with-bare-column query', () => {
    const r = parseAndFix(
      SQL_011,
      SQL_011_FIX,
      'SELECT name, COUNT(*) FROM t',
    );
    expect(r.fired).toBe(true);
    expect(r.fixed).toContain('GROUP BY name');
    expect(r.reFired).toBe(false);
  });

  it('preserves qualified columns (t.name → GROUP BY t.name)', () => {
    const r = parseAndFix(
      SQL_011,
      SQL_011_FIX,
      'SELECT t.name, COUNT(*) FROM t',
    );
    expect(r.fixed).toContain('GROUP BY t.name');
  });

  it('inserts GROUP BY before ORDER BY', () => {
    const r = parseAndFix(
      SQL_011,
      SQL_011_FIX,
      'SELECT name, COUNT(*) FROM t ORDER BY 2 DESC',
    );
    expect(r.fixed).toContain('GROUP BY name');
    expect(r.fixed).toMatch(/GROUP BY name\s+ORDER BY/);
  });

  it('inserts GROUP BY before HAVING', () => {
    const r = parseAndFix(
      SQL_011,
      SQL_011_FIX,
      'SELECT name, COUNT(*) c FROM t HAVING c > 3',
    );
    expect(r.fixed).toMatch(/GROUP BY name\s+HAVING/);
  });

  it('inserts GROUP BY before LIMIT', () => {
    const r = parseAndFix(
      SQL_011,
      SQL_011_FIX,
      'SELECT name, COUNT(*) FROM t LIMIT 10',
    );
    expect(r.fixed).toMatch(/GROUP BY name\s+LIMIT/);
  });

  it('returns null when GROUP BY is already present', () => {
    const r = parseAndFix(
      SQL_011,
      SQL_011_FIX,
      'SELECT name, COUNT(*) FROM t GROUP BY name',
    );
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });

  it('returns null when there are no aggregates', () => {
    const r = parseAndFix(SQL_011, SQL_011_FIX, 'SELECT name FROM t');
    expect(r.fired).toBe(false);
    expect(r.fixed).toBeNull();
  });

  it('produces parseable SQL', () => {
    const r = parseAndFix(SQL_011, SQL_011_FIX, 'SELECT name, COUNT(*) FROM t');
    expect(r.fixed).not.toBeNull();
    const r2 = parseQuery(r.fixed!);
    expect(r2.error).toBeUndefined();
  });
});
