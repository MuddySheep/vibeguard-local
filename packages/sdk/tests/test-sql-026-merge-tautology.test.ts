import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_026 } from '../src/rules/sql-026-merge-tautology.js';

  // SQL-026 — MERGE with tautological ON.
  //
  // Phase 1 scaffolding tests:
  //   - Positive fixtures are `it.skip`'d. They become live in Phase 3
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
    return SQL_026(r.ast);
  }

  describe('SQL-026 — positive fixtures (Phase 3 unskips)', () => {
    it('fires on MERGE ON 1=1', () => {
      const c = fire("MERGE INTO target USING source ON 1=1 WHEN MATCHED THEN UPDATE SET col = 'x'");
      expect(c?.code).toBe('SQL-026');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });

  it('fires on MERGE ON true ... WHEN MATCHED THEN DELETE', () => {
      const c = fire("MERGE INTO users USING bad_users ON true WHEN MATCHED THEN DELETE");
      expect(c?.code).toBe('SQL-026');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });

  it('fires on MERGE ON s.id = s.id', () => {
      const c = fire("MERGE INTO t USING s ON s.id = s.id WHEN MATCHED THEN UPDATE SET col = 1");
      expect(c?.code).toBe('SQL-026');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });
  });

  describe('SQL-026 — negative fixtures (must not fire)', () => {
    it('does not fire on legitimate MERGE join', () => {
      expect(fire("MERGE INTO target t USING source s ON t.id = s.id WHEN MATCHED THEN UPDATE SET col = s.col")).toBeNull();
    });

  it('does not fire on compound predicate', () => {
      expect(fire("MERGE INTO t USING s ON t.id = s.id AND s.active WHEN MATCHED THEN UPDATE SET col = 1")).toBeNull();
    });

  it('does not fire on plain UPDATE', () => {
      expect(fire("UPDATE users SET email = 'x' WHERE id = 1")).toBeNull();
    });
  });

  describe('SQL-026 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE; DROP TABLE backup;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-026');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE; DROP TABLE backup;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  