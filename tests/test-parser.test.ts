import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { __resetForTests, init, parseQuery } from '../src/parser.js';

// STORY 1.3 parser-wrapper tests.
//
// Test plan:
//   - Pre-init: parseQuery returns parseError, never throws
//   - After init: parseQuery handles SELECT / INSERT / UPDATE / DELETE
//   - After init: parseQuery returns parseError on invalid / empty / whitespace SQL
//   - After init: parseQuery handles multi-statement scripts
//   - Error path: malformed SQL produces structured error with cursor
//
// NOTE on test ordering: vitest runs files in parallel by default but
// tests inside a file run sequentially. This file mutates module state
// (init) and uses the test-only `__resetForTests` hatch to verify the
// pre-init branch. We reset BEFORE the pre-init test, then re-init
// for the rest of the file's tests.

describe('parseQuery — pre-init behavior', () => {
  beforeAll(() => {
    __resetForTests();
  });

  it('returns parseError (does not throw) when init() has not been called', () => {
    const r = parseQuery('SELECT 1');
    expect(r.error).toBeDefined();
    expect(r.error?.message).toContain('not initialized');
    expect(r.ast).toEqual({ stmts: [] });
  });
});

describe('parseQuery — after init()', () => {
  beforeAll(async () => {
    __resetForTests();
    await init();
  });

  afterAll(() => {
    // Leave initialized for subsequent test files (substrate, public-api)
    // that depend on a live parser.
  });

  it('parses a valid SELECT', () => {
    const r = parseQuery('SELECT 1');
    expect(r.error).toBeUndefined();
    const ast = r.ast as { stmts: unknown[] };
    expect(ast.stmts).toHaveLength(1);
  });

  it('parses INSERT', () => {
    const r = parseQuery("INSERT INTO t (a) VALUES (1)");
    expect(r.error).toBeUndefined();
  });

  it('parses UPDATE', () => {
    const r = parseQuery("UPDATE t SET a = 1");
    expect(r.error).toBeUndefined();
  });

  it('parses DELETE', () => {
    const r = parseQuery("DELETE FROM t");
    expect(r.error).toBeUndefined();
  });

  it('parses multi-statement script', () => {
    const r = parseQuery('SELECT 1; SELECT 2');
    expect(r.error).toBeUndefined();
    const ast = r.ast as { stmts: unknown[] };
    expect(ast.stmts.length).toBeGreaterThanOrEqual(2);
  });

  it('parses qualified table names (schema.table)', () => {
    const r = parseQuery('SELECT * FROM public.users');
    expect(r.error).toBeUndefined();
  });

  it('returns structured error on invalid SQL (does not throw)', () => {
    const r = parseQuery('SELEKT 1 FROM');
    expect(() => parseQuery('SELEKT 1 FROM')).not.toThrow();
    expect(r.error).toBeDefined();
    expect(r.error?.message).toBeTruthy();
  });

  it('returns parseError on empty input', () => {
    const r = parseQuery('');
    expect(r.error?.message).toContain('empty');
    expect(r.ast).toEqual({ stmts: [] });
  });

  it('returns parseError on whitespace-only input', () => {
    const r = parseQuery('   \n\t  ');
    expect(r.error?.message).toContain('empty');
  });

  it('treats non-string input as empty (does not throw)', () => {
    // Force-cast through unknown to test runtime defensiveness.
    const r = parseQuery(undefined as unknown as string);
    expect(r.error).toBeDefined();
  });

  it('init() is idempotent (safe to call multiple times)', async () => {
    await init();
    await init();
    const r = parseQuery('SELECT 42');
    expect(r.error).toBeUndefined();
  });

  it('returned AST has the expected libpg-query top-level shape', () => {
    const r = parseQuery('SELECT 1');
    expect(r.error).toBeUndefined();
    const ast = r.ast as { version?: number; stmts: unknown[] };
    expect(typeof ast.version).toBe('number');
    expect(Array.isArray(ast.stmts)).toBe(true);
  });

  it('error result includes cursor position when libpg-query provides one', () => {
    const r = parseQuery('SELECT 1 FROM x WHERE');
    if (r.error) {
      // cursor is optional; assertion is conditional on libpg-query
      // surfacing it. When present, it's a non-negative number.
      if (typeof r.error.cursor === 'number') {
        expect(r.error.cursor).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
