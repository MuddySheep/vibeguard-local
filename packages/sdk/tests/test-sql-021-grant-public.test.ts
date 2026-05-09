import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_021 } from '../src/rules/sql-021-grant-public.js';

  // SQL-021 — GRANT TO PUBLIC.
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
    return SQL_021(r.ast);
  }

  describe('SQL-021 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on GRANT ALL TO PUBLIC', () => {
      const c = fire("GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC");
      expect(c?.code).toBe('SQL-021');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on GRANT SELECT TO PUBLIC', () => {
      const c = fire("GRANT SELECT ON users TO PUBLIC");
      expect(c?.code).toBe('SQL-021');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on PUBLIC mixed with named role', () => {
      const c = fire("GRANT EXECUTE ON FUNCTION foo() TO public, app_role");
      expect(c?.code).toBe('SQL-021');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });
  });

  describe('SQL-021 — negative fixtures (must not fire)', () => {
    it('does not fire on GRANT to a named role', () => {
      expect(fire("GRANT SELECT ON users TO app_user")).toBeNull();
    });

  it('does not fire on GRANT on schema to specific role', () => {
      expect(fire("GRANT ALL ON SCHEMA app TO app_admin")).toBeNull();
    });

  it('does not fire on REVOKE from PUBLIC', () => {
      expect(fire("REVOKE ALL ON users FROM PUBLIC")).toBeNull();
    });
  });

  describe('SQL-021 — multi-statement composition with SQL-003', () => {
    it('the new rule fires alongside SQL-003', () => {
      const result = analyze("GRANT SELECT ON users TO PUBLIC; UPDATE users SET active = true;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-021');
      expect(codes).toContain('SQL-003');
    });

    it('SQL-003 still fires when the placeholder is in registry', () => {
      const result = analyze("GRANT SELECT ON users TO PUBLIC; UPDATE users SET active = true;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-003');
    });
  });
  