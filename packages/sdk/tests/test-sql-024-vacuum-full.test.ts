import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_024 } from '../src/rules/sql-024-vacuum-full.js';

  // SQL-024 — VACUUM FULL.
  //
  // Phase 1 scaffolding tests:
  //   - Positive fixtures are `it.skip`'d. They become live in Phase 2
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
    return SQL_024(r.ast);
  }

  describe('SQL-024 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on VACUUM FULL <table>', () => {
      const c = fire("VACUUM FULL users");
      expect(c?.code).toBe('SQL-024');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });

  it('fires on VACUUM (FULL, ANALYZE)', () => {
      const c = fire("VACUUM (FULL, ANALYZE) orders");
      expect(c?.code).toBe('SQL-024');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });

  it('fires on bare lowercase vacuum full', () => {
      const c = fire("vacuum full");
      expect(c?.code).toBe('SQL-024');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });
  });

  describe('SQL-024 — negative fixtures (must not fire)', () => {
    it('does not fire on plain VACUUM', () => {
      expect(fire("VACUUM users")).toBeNull();
    });

  it('does not fire on VACUUM ANALYZE (no FULL)', () => {
      expect(fire("VACUUM ANALYZE users")).toBeNull();
    });

  it('does not fire on VACUUM (VERBOSE)', () => {
      expect(fire("VACUUM (VERBOSE) users")).toBeNull();
    });
  });

  describe('SQL-024 — multi-statement composition with SQL-003', () => {
    it('the new rule fires alongside SQL-003', () => {
      const result = analyze("VACUUM FULL users; UPDATE users SET active = true;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-024');
      expect(codes).toContain('SQL-003');
    });

    it('SQL-003 still fires when the placeholder is in registry', () => {
      const result = analyze("VACUUM FULL users; UPDATE users SET active = true;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-003');
    });
  });
  