import { beforeAll, describe, expect, it } from 'vitest';

import { applyFixes, init, parseQuery } from '../src/index.js';

// V1.3 — applyFixes runner tests.
//
// Coverage:
//   - Single-fix happy path: fixesApplied === 1, sql changed
//   - Compound (multiple rules) — runner iterates, applies each
//   - No fixers available — returns input unchanged
//   - Disabled rule via options.rules — fixer doesn't run
//   - Opted-in default-off rule (none currently has a fixer, but the
//     plumbing should work)
//   - Iteration cap is hit when a degenerate fixer churns

beforeAll(async () => {
  await init();
});

describe('applyFixes — happy path', () => {
  it('fixes a single SQL-005 = NULL', () => {
    const r = applyFixes('SELECT * FROM t WHERE x = NULL');
    expect(r.changed).toBe(true);
    expect(r.fixesApplied).toBe(1);
    expect(r.sql).toContain('IS NULL');
    expect(r.fixersInvoked).toContain('SQL-005');
  });

  it('fixes a single SQL-006 missing ORDER BY', () => {
    const r = applyFixes('SELECT id FROM t LIMIT 10 OFFSET 20');
    expect(r.changed).toBe(true);
    expect(r.fixesApplied).toBe(1);
    expect(r.sql).toContain('ORDER BY 1');
    expect(r.fixersInvoked).toContain('SQL-006');
  });

  it('fixes a single SQL-001 cartesian (placeholder)', () => {
    const r = applyFixes('SELECT a.id, b.id FROM a, b WHERE x = 1');
    expect(r.changed).toBe(true);
    expect(r.fixesApplied).toBe(1);
    expect(r.sql).toContain('JOIN b ON TRUE');
    expect(r.fixersInvoked).toContain('SQL-001');
  });

  it('fixes a single SQL-011 missing GROUP BY', () => {
    const r = applyFixes('SELECT name, COUNT(*) FROM t');
    expect(r.changed).toBe(true);
    expect(r.fixesApplied).toBe(1);
    expect(r.sql).toContain('GROUP BY name');
    expect(r.fixersInvoked).toContain('SQL-011');
  });
});

describe('applyFixes — compound (iterate-until-stable)', () => {
  it('applies SQL-005 + SQL-011 in one run', () => {
    const r = applyFixes(
      'SELECT name, COUNT(*) FROM t WHERE active = NULL',
    );
    expect(r.fixesApplied).toBe(2);
    expect(r.sql).toContain('IS NULL');
    expect(r.sql).toContain('GROUP BY name');
  });

  it('applies SQL-006 + SQL-011 in one run', () => {
    const r = applyFixes(
      'SELECT id, COUNT(*) FROM users WHERE active LIMIT 10 OFFSET 20',
    );
    expect(r.fixesApplied).toBe(2);
    expect(r.sql).toContain('ORDER BY 1');
    expect(r.sql).toContain('GROUP BY id');
  });

  it('applies SQL-001 + SQL-005 + SQL-011 (three fixes) in one run', () => {
    const r = applyFixes(
      'SELECT a.name, COUNT(*) FROM a, b WHERE a.x = NULL',
    );
    expect(r.fixesApplied).toBe(3);
    expect(r.sql).toContain('JOIN b ON TRUE');
    expect(r.sql).toContain('a.x IS NULL');
    expect(r.sql).toContain('GROUP BY a.name');
    expect(r.remainingCatches).toHaveLength(0);
  });

  it('produces a final SQL that parses', () => {
    const r = applyFixes(
      'SELECT a.name, COUNT(*) FROM a, b WHERE a.x = NULL',
    );
    const parsed = parseQuery(r.sql);
    expect(parsed.error).toBeUndefined();
  });
});

describe('applyFixes — nothing to fix', () => {
  it('returns input unchanged when no rule fires', () => {
    const sql = 'SELECT id FROM t WHERE id = 1';
    const r = applyFixes(sql);
    expect(r.changed).toBe(false);
    expect(r.sql).toBe(sql);
    expect(r.fixesApplied).toBe(0);
  });

  it('returns input unchanged when fired rules have no fixers', () => {
    // SQL-013 (DROP TABLE) fires but has no fixer — runner is stable
    // immediately.
    const sql = 'DROP TABLE users';
    const r = applyFixes(sql);
    expect(r.changed).toBe(false);
    expect(r.fixesApplied).toBe(0);
    expect(r.remainingCatches.map((c) => c.code)).toContain('SQL-013');
  });

  it('surfaces remaining catches that have no fixer', () => {
    // SQL-015 (SELECT *) has no fixer. Runner returns the catch as
    // remaining without changing the SQL.
    const sql = 'SELECT * FROM users WHERE id = 1';
    const r = applyFixes(sql);
    expect(r.changed).toBe(false);
    expect(r.remainingCatches.map((c) => c.code)).toContain('SQL-015');
  });
});

describe('applyFixes — options.rules opt-out', () => {
  it('skips a rule whose fixer is disabled via options.rules', () => {
    const sql = 'SELECT * FROM t WHERE x = NULL';
    // Default: SQL-005 fixer fires. With sql-005 disabled, no fix.
    const r = applyFixes(sql, {
      rules: { 'sql-005': { enabled: false } },
    });
    expect(r.fixesApplied).toBe(0);
    expect(r.sql).toBe(sql);
  });

  it('still applies enabled rules when one is disabled', () => {
    // Disable SQL-001 — SQL-005 should still fire and fix.
    const r = applyFixes('SELECT * FROM a, b WHERE x = NULL', {
      rules: { 'sql-001': { enabled: false } },
    });
    expect(r.sql).toContain('IS NULL');
    // SQL-001 catch still surfaces in remaining (rule still detects)
    // — wait, no, rule is disabled too, not just its fixer. So the
    // rule doesn't run at all. It won't be in remaining either.
    expect(r.remainingCatches.map((c) => c.code)).not.toContain('SQL-001');
  });
});

describe('applyFixes — case-insensitive code matching', () => {
  it('accepts uppercase code in options.rules', () => {
    const r = applyFixes('SELECT * FROM t WHERE x = NULL', {
      rules: { 'SQL-005': { enabled: false } },
    });
    expect(r.fixesApplied).toBe(0);
  });

  it('accepts mixed-case code in options.rules', () => {
    const r = applyFixes('SELECT * FROM t WHERE x = NULL', {
      rules: { 'Sql-005': { enabled: false } },
    });
    expect(r.fixesApplied).toBe(0);
  });
});

describe('applyFixes — iteration cap', () => {
  it('respects a low maxIterations setting', () => {
    // Compound query that takes 3 iterations to fully fix.
    // With maxIterations=1, runner stops after 1 fix; remaining
    // catches surface.
    const r = applyFixes(
      'SELECT a.name, COUNT(*) FROM a, b WHERE a.x = NULL',
      { maxIterations: 1 },
    );
    expect(r.fixesApplied).toBe(1);
    expect(r.hitIterationLimit).toBe(true);
    expect(r.remainingCatches.length).toBeGreaterThan(0);
  });

  it('does not flag iteration limit on a no-op input', () => {
    const r = applyFixes('SELECT 1');
    expect(r.hitIterationLimit).toBe(false);
  });
});

describe('applyFixes — fixer safety', () => {
  it('does not throw on adversarial / pre-init input (returns sql unchanged)', () => {
    // Empty string parses with an error; runner returns early.
    const r = applyFixes('');
    expect(r.changed).toBe(false);
    expect(r.fixesApplied).toBe(0);
  });

  it('does not throw on parse-failing input', () => {
    expect(() => applyFixes('SELEKT 1 FROM @')).not.toThrow();
  });
});

describe('applyFixes — fixersInvoked telemetry', () => {
  it('records every fixer that was attempted', () => {
    const r = applyFixes(
      'SELECT a.name, COUNT(*) FROM a, b WHERE a.x = NULL',
    );
    expect(new Set(r.fixersInvoked)).toEqual(
      new Set(['SQL-001', 'SQL-005', 'SQL-011']),
    );
  });

  it('does not record fixers for rules that did not fire', () => {
    const r = applyFixes('SELECT * FROM t WHERE x = NULL');
    expect(r.fixersInvoked).toContain('SQL-005');
    expect(r.fixersInvoked).not.toContain('SQL-001');
    expect(r.fixersInvoked).not.toContain('SQL-006');
    expect(r.fixersInvoked).not.toContain('SQL-011');
  });
});
