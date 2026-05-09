import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_027 } from '../src/rules/sql-027-set-search-path.js';

  // SQL-027 — SET search_path attack pattern.
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
    return SQL_027(r.ast);
  }

  describe('SQL-027 — positive fixtures (Phase 3 unskips)', () => {
    it('fires on attacker_schema first', () => {
      const c = fire("SET search_path = attacker_schema, public, pg_catalog");
      expect(c?.code).toBe('SQL-027');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(85);
    });

  it('fires on public before pg_catalog (CVE-2018-1058)', () => {
      const c = fire("SET LOCAL search_path TO public, pg_catalog");
      expect(c?.code).toBe('SQL-027');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(85);
    });

  it('fires on $user before pg_catalog', () => {
      const c = fire("SET search_path = \"$user\", public");
      expect(c?.code).toBe('SQL-027');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(85);
    });
  });

  describe('SQL-027 — negative fixtures (must not fire)', () => {
    it('does not fire on pg_catalog first', () => {
      expect(fire("SET search_path = pg_catalog, public")).toBeNull();
    });

  it('does not fire on pg_catalog, pg_temp', () => {
      expect(fire("SET search_path = pg_catalog, pg_temp")).toBeNull();
    });

  it('does not fire on RESET search_path', () => {
      expect(fire("RESET search_path")).toBeNull();
    });

  it('does not fire on SHOW search_path', () => {
      expect(fire("SHOW search_path")).toBeNull();
    });
  });

  describe('SQL-027 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("SET search_path = attacker, public; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-027');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("SET search_path = attacker, public; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  