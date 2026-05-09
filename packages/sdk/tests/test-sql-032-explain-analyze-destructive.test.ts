import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_032 } from '../src/rules/sql-032-explain-analyze-destructive.js';

  // SQL-032 — EXPLAIN ANALYZE wrapping destructive statement.
  //
  // Phase 1 scaffolding tests:
  //   - Positive fixtures are `it.skip`'d. They become live in Phase 4
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
    return SQL_032(r.ast);
  }

  describe('SQL-032 — positive fixtures (Phase 4 unskips)', () => {
    it('fires on EXPLAIN ANALYZE DELETE', () => {
      const c = fire("EXPLAIN ANALYZE DELETE FROM users");
      expect(c?.code).toBe('SQL-032');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(80);
    });

  it('fires on EXPLAIN (ANALYZE, BUFFERS) UPDATE', () => {
      const c = fire("EXPLAIN (ANALYZE, BUFFERS) UPDATE users SET active = false");
      expect(c?.code).toBe('SQL-032');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(80);
    });

  it('fires on EXPLAIN ANALYZE INSERT', () => {
        const c = fire("EXPLAIN ANALYZE INSERT INTO users (id) VALUES (1)");
        expect(c?.code).toBe('SQL-032');
        expect(c?.severity).toBe('info');
        expect(c?.confidence).toBe(80);
      });
  });

  describe('SQL-032 — negative fixtures (must not fire)', () => {
    it('does not fire on plain EXPLAIN DELETE (no ANALYZE)', () => {
      expect(fire("EXPLAIN DELETE FROM users")).toBeNull();
    });

  it('does not fire on EXPLAIN ANALYZE SELECT', () => {
      expect(fire("EXPLAIN ANALYZE SELECT id FROM users")).toBeNull();
    });

  it('does not fire on EXPLAIN (BUFFERS) SELECT', () => {
      expect(fire("EXPLAIN (BUFFERS) SELECT 1")).toBeNull();
    });
  });

  describe('SQL-032 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("EXPLAIN ANALYZE DELETE FROM users; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-032');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("EXPLAIN ANALYZE DELETE FROM users; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  