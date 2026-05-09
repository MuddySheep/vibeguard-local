import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_025 } from '../src/rules/sql-025-refresh-matview.js';

  // SQL-025 — REFRESH MATERIALIZED VIEW (non-concurrent).
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
    return SQL_025(r.ast);
  }

  describe('SQL-025 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on REFRESH MATERIALIZED VIEW', () => {
      const c = fire("REFRESH MATERIALIZED VIEW user_summary");
      expect(c?.code).toBe('SQL-025');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(75);
    });

  it('fires on REFRESH ... WITH DATA', () => {
      const c = fire("REFRESH MATERIALIZED VIEW stats_view WITH DATA");
      expect(c?.code).toBe('SQL-025');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(75);
    });

  it('fires on lowercase refresh materialized view', () => {
      const c = fire("refresh materialized view daily_summary");
      expect(c?.code).toBe('SQL-025');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(75);
    });
  });

  describe('SQL-025 — negative fixtures (must not fire)', () => {
    it('does not fire on REFRESH MATERIALIZED VIEW CONCURRENTLY', () => {
      expect(fire("REFRESH MATERIALIZED VIEW CONCURRENTLY user_summary")).toBeNull();
    });

  it('does not fire on REFRESH MATERIALIZED VIEW CONCURRENTLY (alternate target)', () => {
      expect(fire("REFRESH MATERIALIZED VIEW CONCURRENTLY stats_view")).toBeNull();
    });

  it('does not fire on plain SELECT against the view', () => {
      expect(fire("SELECT * FROM user_summary")).toBeNull();
    });
  });

  describe('SQL-025 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("REFRESH MATERIALIZED VIEW user_summary; DROP TABLE stale_data;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-025');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("REFRESH MATERIALIZED VIEW user_summary; DROP TABLE stale_data;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  