import { beforeAll, describe, expect, it } from 'vitest';

import { init } from '@vibeguard-dev/local';

import {
  createVibeGuardHook,
  formatFeedback,
} from '../src/replit-agent-hook.js';

beforeAll(async () => {
  await init();
});

describe('createVibeGuardHook — allowed path', () => {
  it('allows clean SQL with empty feedback', () => {
    const hook = createVibeGuardHook();
    const r = hook('SELECT * FROM users WHERE id = 1');
    expect(r.allowed).toBe(true);
    expect(r.catches).toHaveLength(0);
    expect(r.feedback).toBe('');
  });

  it('allows warn/info-severity catches under default blockOn=block', () => {
    const hook = createVibeGuardHook();
    const r = hook("SELECT * FROM users WHERE email = NULL");
    expect(r.allowed).toBe(true);
    expect(r.catches.some((c) => c.code === 'SQL-005')).toBe(true);
    expect(r.feedback).toContain('SQL-005');
  });

  it('echoes the SQL back unchanged', () => {
    const hook = createVibeGuardHook();
    const sql = 'SELECT * FROM users WHERE id = 42';
    const r = hook(sql);
    expect(r.sql).toBe(sql);
  });
});

describe('createVibeGuardHook — blocked path', () => {
  it('blocks block-severity catches with formatted feedback', () => {
    const hook = createVibeGuardHook();
    const r = hook("UPDATE users SET email='x'");
    expect(r.allowed).toBe(false);
    expect(r.catches.some((c) => c.code === 'SQL-003')).toBe(true);
    expect(r.feedback).toContain('SQL-003');
    expect(r.feedback).toContain('Fix:');
  });

  it('blocks parse errors with the parser message in feedback', () => {
    const hook = createVibeGuardHook();
    const r = hook('SELEKT * FROM bad');
    expect(r.allowed).toBe(false);
    expect(r.feedback).toContain('Parse error:');
    expect(r.catches).toHaveLength(0);
  });

  it('blocks empty SQL via parse-error path', () => {
    const hook = createVibeGuardHook();
    const r = hook('');
    expect(r.allowed).toBe(false);
    expect(r.feedback).toContain('Parse error');
  });
});

describe('createVibeGuardHook — configuration', () => {
  it('honors blockOn=warn (warn-severity now blocks)', () => {
    const hook = createVibeGuardHook({ blockOn: 'warn' });
    const r = hook("SELECT * FROM users WHERE email = NULL");
    expect(r.allowed).toBe(false);
    expect(r.catches.some((c) => c.code === 'SQL-005')).toBe(true);
  });

  it('honors blockOn=info (info-severity now blocks)', () => {
    const hook = createVibeGuardHook({ blockOn: 'info' });
    const r = hook('SELECT DISTINCT * FROM users');
    expect(r.allowed).toBe(false);
    expect(r.catches.some((c) => c.code === 'SQL-009')).toBe(true);
  });

  it('truncates feedback at maxFeedbackChars', () => {
    const hook = createVibeGuardHook({ maxFeedbackChars: 50 });
    const r = hook("UPDATE users SET email='x'");
    expect(r.feedback.length).toBeLessThanOrEqual(50);
    expect(r.feedback.endsWith('...')).toBe(true);
  });

  it('disables truncation when maxFeedbackChars=0', () => {
    const hook = createVibeGuardHook({ maxFeedbackChars: 0 });
    const r = hook("UPDATE users SET email='x'");
    // No truncation suffix should appear at the very end of a single
    // catch's full feedback.
    expect(r.feedback).not.toMatch(/\.\.\.$/);
    // Full SQL-003 fix message ends in "...explicit operator review."
    expect(r.feedback).toContain('explicit operator review');
  });
});

describe('formatFeedback', () => {
  it('returns empty string for empty catch list', () => {
    expect(formatFeedback([], 1000)).toBe('');
  });

  it('produces a numbered list with code/severity/confidence', () => {
    const out = formatFeedback(
      [
        {
          code: 'SQL-001',
          title: 'Cartesian explosion risk',
          severity: 'block',
          confidence: 95,
          detail: 'two tables in FROM',
          fix: 'add JOIN',
          threatCategories: ['denial-of-service'],
        },
        {
          code: 'SQL-005',
          title: 'NULL comparison',
          severity: 'warn',
          confidence: 95,
          detail: 'col = NULL is UNKNOWN',
          fix: 'use IS NULL',
          threatCategories: ['corruption'],
        },
      ],
      1000,
    );
    expect(out).toMatch(/^1\. \[SQL-001 block\/95\]/);
    expect(out).toContain('2. [SQL-005 warn/95]');
    expect(out).toContain('Fix: add JOIN');
  });
});
