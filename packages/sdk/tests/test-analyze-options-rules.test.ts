import { beforeAll, describe, expect, it } from 'vitest';

import { analyze, init, RULE_REGISTRY, RULES } from '../src/index.js';

// V1.1 — AnalyzeOptions.rules opt-in / opt-out tests.
// Targets the new per-rule override mechanism added in V1.1 to support
// default-OFF rules (SQL-014). The rule itself is tested in isolation
// in test-sql-014-missing-returning.test.ts; this file covers the
// public-API plumbing that decides whether the rule runs.

beforeAll(async () => {
  await init();
});

// ----------------------------------------------------------------------
// Default behavior (no overrides) — RULES is the default-enabled set
// ----------------------------------------------------------------------

describe('analyze — default rule enablement', () => {
  it('does not fire SQL-014 by default (it is OPT-IN)', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')");
    const codes = r.catches.map((c) => c.code);
    expect(codes).not.toContain('SQL-014');
  });

  it('fires SQL-013 by default (it is default-ON)', () => {
    const r = analyze('DROP TABLE users');
    const codes = r.catches.map((c) => c.code);
    expect(codes).toContain('SQL-013');
  });

  it('fires SQL-015 by default (it is default-ON)', () => {
    const r = analyze('SELECT * FROM users');
    const codes = r.catches.map((c) => c.code);
    expect(codes).toContain('SQL-015');
  });

  it('RULES contains all default-enabled entries from RULE_REGISTRY', () => {
    const expectedDefaultOnCount = RULE_REGISTRY.filter(
      (e) => e.defaultEnabled,
    ).length;
    expect(RULES.length).toBe(expectedDefaultOnCount);
  });

  it('RULE_REGISTRY contains SQL-014 even though RULES does not', () => {
    const codes = RULE_REGISTRY.map((e) => e.code);
    expect(codes).toContain('SQL-014');
  });
});

// ----------------------------------------------------------------------
// Opt-in to default-OFF rules
// ----------------------------------------------------------------------

describe('analyze — opt-in to default-OFF rules', () => {
  it('fires SQL-014 when explicitly enabled via options.rules', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'sql-014': { enabled: true } },
    });
    const codes = r.catches.map((c) => c.code);
    expect(codes).toContain('SQL-014');
  });

  it('the catch detail names the table', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'sql-014': { enabled: true } },
    });
    const c = r.catches.find((c) => c.code === 'SQL-014');
    expect(c?.detail).toContain('users');
  });

  it('does not fire SQL-014 when explicitly disabled (no-op for default-OFF)', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'sql-014': { enabled: false } },
    });
    const codes = r.catches.map((c) => c.code);
    expect(codes).not.toContain('SQL-014');
  });
});

// ----------------------------------------------------------------------
// Opt-out of default-ON rules
// ----------------------------------------------------------------------

describe('analyze — opt-out of default-ON rules', () => {
  it('does not fire SQL-015 when disabled via options.rules', () => {
    const r = analyze('SELECT * FROM users', {
      rules: { 'sql-015': { enabled: false } },
    });
    const codes = r.catches.map((c) => c.code);
    expect(codes).not.toContain('SQL-015');
  });

  it('does not fire SQL-013 when disabled via options.rules', () => {
    const r = analyze('DROP TABLE users', {
      rules: { 'sql-013': { enabled: false } },
    });
    const codes = r.catches.map((c) => c.code);
    expect(codes).not.toContain('SQL-013');
  });

  it('disabling one rule does not affect others', () => {
    // SELECT * FROM a, b fires both SQL-001 (cartesian) and SQL-015 (star).
    // Disabling SQL-015 should leave SQL-001.
    const r = analyze('SELECT * FROM a, b', {
      rules: { 'sql-015': { enabled: false } },
    });
    const codes = r.catches.map((c) => c.code);
    expect(codes).toContain('SQL-001');
    expect(codes).not.toContain('SQL-015');
  });
});

// ----------------------------------------------------------------------
// Mixed overrides (opt-in + opt-out simultaneously)
// ----------------------------------------------------------------------

describe('analyze — mixed opt-in / opt-out', () => {
  it('opt-in SQL-014 + opt-out SQL-013 simultaneously', () => {
    // INSERT without RETURNING fires SQL-014 (when opted in).
    // DROP TABLE fires SQL-013 by default — disabling it suppresses.
    // The two statements together test both overrides at once.
    const r = analyze(
      "INSERT INTO users (email) VALUES ('a@b.com'); DROP TABLE old_users",
      {
        rules: {
          'sql-014': { enabled: true },
          'sql-013': { enabled: false },
        },
      },
    );
    const codes = r.catches.map((c) => c.code);
    expect(codes).toContain('SQL-014');
    expect(codes).not.toContain('SQL-013');
  });
});

// ----------------------------------------------------------------------
// Case-insensitive matching of catch codes in options.rules
// ----------------------------------------------------------------------

describe('analyze — options.rules code matching is case-insensitive', () => {
  it('accepts lowercase code', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'sql-014': { enabled: true } },
    });
    expect(r.catches.map((c) => c.code)).toContain('SQL-014');
  });

  it('accepts uppercase code', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'SQL-014': { enabled: true } },
    });
    expect(r.catches.map((c) => c.code)).toContain('SQL-014');
  });

  it('accepts mixed-case code', () => {
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'Sql-014': { enabled: true } },
    });
    expect(r.catches.map((c) => c.code)).toContain('SQL-014');
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('analyze — options.rules edge cases', () => {
  it('unknown rule codes in overrides are silently ignored', () => {
    const r = analyze('DROP TABLE users', {
      rules: {
        'sql-999': { enabled: true },
        'made-up-rule': { enabled: false },
      },
    });
    // SQL-013 still fires (defaulted on, no override matched).
    expect(r.catches.map((c) => c.code)).toContain('SQL-013');
  });

  it('options.rules without enabled key is a no-op for that code', () => {
    // If `enabled` is undefined, the rule keeps its defaultEnabled
    // setting. SQL-014 is default-OFF so it should NOT fire.
    const r = analyze("INSERT INTO users (email) VALUES ('a@b.com')", {
      rules: { 'sql-014': {} },
    });
    expect(r.catches.map((c) => c.code)).not.toContain('SQL-014');
  });

  it('empty options.rules object is a no-op (defaults apply)', () => {
    const r = analyze('SELECT * FROM users', { rules: {} });
    expect(r.catches.map((c) => c.code)).toContain('SQL-015');
  });

  it('passing only logger (no rules) preserves V1.0 behavior', () => {
    const r = analyze('SELECT * FROM users', {
      logger: { error: () => {} },
    });
    expect(r.catches.map((c) => c.code)).toContain('SQL-015');
  });
});
