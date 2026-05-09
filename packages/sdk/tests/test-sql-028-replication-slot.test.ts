import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_028 } from '../src/rules/sql-028-replication-slot.js';

  // SQL-028 — pg_create_*_replication_slot.
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
    return SQL_028(r.ast);
  }

  describe('SQL-028 — positive fixtures (Phase 3 unskips)', () => {
    it('fires on pg_create_logical_replication_slot', () => {
      const c = fire("SELECT pg_create_logical_replication_slot('slot1', 'pgoutput')");
      expect(c?.code).toBe('SQL-028');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });

  it('fires on pg_create_physical_replication_slot', () => {
      const c = fire("SELECT pg_create_physical_replication_slot('phys_slot')");
      expect(c?.code).toBe('SQL-028');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });

  it('fires on lowercase pg_create_logical_replication_slot', () => {
      const c = fire("select pg_create_logical_replication_slot('s', 'pgoutput')");
      expect(c?.code).toBe('SQL-028');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });
  });

  describe('SQL-028 — negative fixtures (must not fire)', () => {
    it('does not fire on pg_drop_replication_slot', () => {
      expect(fire("SELECT pg_drop_replication_slot('slot1')")).toBeNull();
    });

  it('does not fire on read of pg_replication_slots', () => {
      expect(fire("SELECT * FROM pg_replication_slots")).toBeNull();
    });

  it('does not fire on plain SELECT', () => {
      expect(fire("SELECT 1")).toBeNull();
    });
  });

  describe('SQL-028 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("SELECT pg_create_logical_replication_slot('s','pgoutput'); DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-028');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("SELECT pg_create_logical_replication_slot('s','pgoutput'); DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  
  describe('SQL-028 — non-SELECT contexts (regression for v1.6.0 perf opt)', () => {
    it('fires inside INSERT … SELECT pg_create_logical_replication_slot(...)', () => {
      const r = parseQuery("INSERT INTO slots SELECT pg_create_logical_replication_slot('s', 'pgoutput')");
      expect(r.error).toBeUndefined();
      expect(SQL_028(r.ast!)).not.toBeNull();
    });
  });
