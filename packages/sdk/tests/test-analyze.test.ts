import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  analyze,
  astWalk,
  extractColumns,
  extractFromTables,
  init,
  parseQuery,
  RULES,
  runRules,
} from '../src/index.js';

// STORY 1.6 — Public API tests.
//
// Replaces the placeholder smoke.test.ts from STORY 1.1. Verifies the
// real `analyze(sql, options?)` function plus the substrate /
// helper exports promised in README and ARCHITECTURE.md.

beforeAll(async () => {
  await init();
});

describe('analyze (public API)', () => {
  it('exports a callable function', () => {
    expect(typeof analyze).toBe('function');
  });

  it('returns empty catches array for safe queries', () => {
    expect(analyze('SELECT 1').catches).toHaveLength(0);
    // V1.1: explicit columns required, since `SELECT *` now fires SQL-015.
    expect(analyze('SELECT id FROM users').catches).toHaveLength(0);
    expect(analyze('UPDATE u SET x=1 WHERE id=$1').catches).toHaveLength(0);
  });

  it('fires SQL-001 on cartesian SELECT', () => {
    // Explicit columns to avoid SQL-015 (SELECT *) firing alongside.
    const r = analyze('SELECT a.id, b.id FROM a, b');
    expect(r.catches).toHaveLength(1);
    expect(r.catches[0]?.code).toBe('SQL-001');
    expect(r.catches[0]?.severity).toBe('block');
  });

  it('returns structured parseError on empty input (does not throw)', () => {
    const r = analyze('');
    expect(r.parseError?.message).toContain('empty');
    expect(r.catches).toHaveLength(0);
  });

  it('returns structured parseError on malformed SQL (does not throw)', () => {
    expect(() => analyze('SELEKT 1 FROM @')).not.toThrow();
    const r = analyze('SELEKT 1 FROM @');
    expect(r.parseError).toBeDefined();
    expect(r.catches).toHaveLength(0);
  });

  it('is synchronous (does not return a Promise)', () => {
    const r = analyze('SELECT 1');
    expect(r).not.toBeInstanceOf(Promise);
    expect(r.catches).toBeDefined();
  });

  it('does not mutate the supplied options object', () => {
    const opts = { logger: { error: () => {} } };
    const before = JSON.stringify(opts);
    analyze('SELECT * FROM a, b', opts);
    expect(JSON.stringify(opts)).toBe(before);
  });

  it('threads logger through to runRules for throw-safety reporting', () => {
    // SQL-001 doesn't throw on its inputs, so the legitimate path
    // doesn't exercise the logger. Verify the contract by passing a
    // custom logger and confirming analyze accepts it without error.
    const logger = { error: vi.fn() };
    const r = analyze('SELECT * FROM a, b', { logger });
    expect(r.catches[0]?.code).toBe('SQL-001');
    // No throws expected → logger should NOT have been called.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('handles multi-statement scripts (analyzes the first SelectStmt)', () => {
    const r = analyze('SELECT * FROM a, b; SELECT 1');
    expect(r.catches[0]?.code).toBe('SQL-001');
  });
});

describe('exports — type and value surface', () => {
  it('exports init as a function', () => {
    expect(typeof init).toBe('function');
  });

  it('exports parseQuery as a function', () => {
    expect(typeof parseQuery).toBe('function');
  });

  it('exports the substrate helpers', () => {
    expect(typeof astWalk).toBe('function');
    expect(typeof extractFromTables).toBe('function');
    expect(typeof extractColumns).toBe('function');
    expect(typeof runRules).toBe('function');
  });

  it('exports the RULES registry as a non-empty array', () => {
    expect(Array.isArray(RULES)).toBe(true);
    expect(RULES.length).toBeGreaterThanOrEqual(1);
    for (const rule of RULES) {
      expect(typeof rule).toBe('function');
    }
  });

  it('every rule in RULES is callable on a parsed AST without throwing', () => {
    const r = parseQuery('SELECT 1');
    for (const rule of RULES) {
      expect(() => rule(r.ast)).not.toThrow();
    }
  });

  it('RULES contains SQL-001 — registry wiring spot-check', () => {
    // Explicit columns isolate SQL-001 from the SQL-015 (SELECT *) signal.
    const r = parseQuery('SELECT a.id, b.id FROM a, b');
    const fired = RULES.map((rule) => rule(r.ast)).filter((c) => c !== null);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.code).toBe('SQL-001');
  });
});

describe('end-to-end smoke', () => {
  it('analyze() composes parser + runner + RULES correctly', () => {
    // Reach for both happy and unhappy paths to confirm wiring.
    // Explicit columns to avoid SQL-015 (SELECT *) firing.
    const safe = analyze('SELECT id FROM users WHERE id = $1');
    expect(safe.catches).toHaveLength(0);
    expect(safe.parseError).toBeUndefined();

    const cartesian = analyze('SELECT a.id, b.id FROM a, b');
    expect(cartesian.catches).toHaveLength(1);
    expect(cartesian.parseError).toBeUndefined();

    const broken = analyze('SELEKT 1');
    expect(broken.catches).toHaveLength(0);
    expect(broken.parseError).toBeDefined();
  });
});
