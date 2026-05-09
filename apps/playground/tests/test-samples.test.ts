import { describe, expect, it } from 'vitest';

import { SAMPLES, SAMPLE_BY_CODE } from '../src/samples.js';

describe('SAMPLES', () => {
  it('contains exactly 36 entries — one per shipped catch', () => {
    expect(SAMPLES.length).toBe(36);
  });

  it('codes are unique and match SQL-001 .. SQL-036', () => {
    const codes = SAMPLES.map((s) => s.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
    for (let i = 1; i <= 36; i++) {
      const code = `SQL-${String(i).padStart(3, '0')}`;
      expect(codes).toContain(code);
    }
  });

  it('every sample has a non-empty title, description, and SQL', () => {
    for (const s of SAMPLES) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it('SAMPLE_BY_CODE maps every code', () => {
    for (const s of SAMPLES) {
      expect(SAMPLE_BY_CODE.get(s.code)).toBe(s);
    }
  });

  it('SQL-014 carries forceEnable to opt-in to the default-OFF rule', () => {
    const s = SAMPLE_BY_CODE.get('SQL-014');
    expect(s).toBeDefined();
    expect(s!.forceEnable).toBe('sql-014');
  });

  it('only SQL-014 has forceEnable in V1.5+', () => {
    const withForce = SAMPLES.filter((s) => s.forceEnable !== undefined);
    expect(withForce.length).toBe(1);
    expect(withForce[0]!.code).toBe('SQL-014');
  });
});
