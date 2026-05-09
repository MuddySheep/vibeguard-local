import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_034 } from '../src/rules/sql-034-literal-tautology.js';

  // SQL-034 — Literal tautology in WHERE.
  //
  // Phase 1 scaffolding tests:
  //   - Positive fixtures are `it.skip`'d. They become live in Phase 5
  //     when the detection logic ships.
  //   - Negative fixtures run live; they assert the placeholder returns
  //     null on shapes the rule must not flag once implemented.
  //   - The multi-statement composition fixture has two halves: the
  //     "new rule fires" half is skipped; the "existing rule still
  //     fires" half runs live in Phase 1 (it proves we have not
  //     regressed an existing rule by adding the new one).

  beforeAll(async () => {
    await init();
  });

  function fire(sql: string) {
    const r = parseQuery(sql);
    expect(r.error).toBeUndefined();
    return SQL_034(r.ast);
  }

  describe('SQL-034 — positive fixtures (Phase 5 unskips)', () => {
    it('fires on DELETE WHERE 1=1', () => {
      const c = fire("DELETE FROM users WHERE 1=1");
      expect(c?.code).toBe('SQL-034');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on UPDATE WHERE id = id', () => {
      const c = fire("UPDATE users SET banned = true WHERE id = id");
      expect(c?.code).toBe('SQL-034');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on DELETE WHERE true', () => {
      const c = fire("DELETE FROM users WHERE true");
      expect(c?.code).toBe('SQL-034');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on UPDATE WHERE NOT false', () => {
      const c = fire("UPDATE users SET x = 'y' WHERE NOT false");
      expect(c?.code).toBe('SQL-034');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on DELETE WHERE \'a\' = \'a\'', () => {
      const c = fire("DELETE FROM users WHERE 'a' = 'a'");
      expect(c?.code).toBe('SQL-034');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });
  });

  describe('SQL-034 — negative fixtures (must not fire)', () => {
    it('does not fire on WHERE id = 42', () => {
      expect(fire("DELETE FROM users WHERE id = 42")).toBeNull();
    });

  it('does not fire on WHERE active = true (literal on RHS, not whole expr)', () => {
      expect(fire("UPDATE users SET name = 'x' WHERE active = true")).toBeNull();
    });

  it('does not fire on WHERE id IS NOT NULL (documented limitation)', () => {
      expect(fire("DELETE FROM users WHERE id IS NOT NULL")).toBeNull();
    });

  it('does not fire on WHERE id IN (subquery)', () => {
      expect(fire("DELETE FROM users WHERE id IN (SELECT id FROM admins)")).toBeNull();
    });

  it('does not fire on WHERE 1=1 AND id = 42 (compound with real predicate)', () => {
      expect(fire("DELETE FROM users WHERE 1=1 AND id = 42")).toBeNull();
    });
  });

  describe('SQL-034 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("DELETE FROM users WHERE 1=1; DROP TABLE backup;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-034');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("DELETE FROM users WHERE 1=1; DROP TABLE backup;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  