import { describe, expect, it } from 'vitest';

import type {
  AnalysisResult,
  Catch,
  ParseError,
  Rule,
  Severity,
  ThreatCategory,
} from '../src/types.js';

// STORY 1.2 type-shape tests. These are mostly compile-time assertions
// (TypeScript proves the shape is what we claim); the runtime
// `expect(...)` calls just keep vitest happy with at least one
// assertion per test. The real value of this file is the type
// annotations — if a future change drops a field or changes a literal,
// `tsc --noEmit` fails before the test even runs.

describe('Severity', () => {
  it('accepts the three documented values', () => {
    const block: Severity = 'block';
    const warn: Severity = 'warn';
    const info: Severity = 'info';
    expect([block, warn, info]).toHaveLength(3);
  });
});

describe('ThreatCategory', () => {
  it('accepts the six documented categories', () => {
    const cats: ThreatCategory[] = [
      'destruction',
      'exfiltration',
      'injection',
      'denial-of-service',
      'corruption',
      'integrity',
    ];
    expect(cats).toHaveLength(6);
  });
});

describe('Catch', () => {
  it('constructs with all required fields', () => {
    const c: Catch = {
      code: 'SQL-000',
      title: 'Test catch',
      severity: 'info',
      confidence: 50,
      detail: 'Detail message',
      fix: 'Fix suggestion',
      threatCategories: ['integrity'],
    };
    expect(c.code).toBe('SQL-000');
    expect(c.severity).toBe('info');
    expect(c.threatCategories).toEqual(['integrity']);
  });

  it('accepts an optional location', () => {
    const c: Catch = {
      code: 'SQL-000',
      title: 'Test',
      severity: 'warn',
      confidence: 80,
      detail: 'd',
      fix: 'f',
      threatCategories: ['corruption'],
      location: { line: 1, column: 5 },
    };
    expect(c.location?.line).toBe(1);
    expect(c.location?.column).toBe(5);
  });

  it('treats threatCategories as a read-only array', () => {
    const cats: readonly ThreatCategory[] = ['destruction', 'denial-of-service'];
    const c: Catch = {
      code: 'SQL-000',
      title: 'Test',
      severity: 'block',
      confidence: 95,
      detail: 'd',
      fix: 'f',
      threatCategories: cats,
    };
    expect(c.threatCategories).toHaveLength(2);
  });
});

describe('AnalysisResult', () => {
  it('shape with no parseError', () => {
    const r: AnalysisResult = { catches: [] };
    expect(r.catches).toHaveLength(0);
    expect(r.parseError).toBeUndefined();
  });

  it('shape with parseError', () => {
    const r: AnalysisResult = {
      catches: [],
      parseError: { message: 'syntax error at or near "SELEKT"' },
    };
    expect(r.parseError?.message).toContain('syntax error');
  });
});

describe('ParseError', () => {
  it('cursor is optional', () => {
    const eNoCursor: ParseError = { message: 'failed' };
    const eWithCursor: ParseError = { message: 'failed', cursor: 7 };
    expect(eNoCursor.cursor).toBeUndefined();
    expect(eWithCursor.cursor).toBe(7);
  });
});

describe('Rule', () => {
  it('is a function from unknown to Catch | null', () => {
    const ruleFires: Rule = (_ast) => ({
      code: 'SQL-000',
      title: 'Test',
      severity: 'warn',
      confidence: 70,
      detail: 'd',
      fix: 'f',
      threatCategories: ['corruption'],
    });
    const ruleSilent: Rule = (_ast) => null;
    expect(ruleFires({})).not.toBeNull();
    expect(ruleSilent({})).toBeNull();
  });
});
