import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_022 } from '../src/rules/sql-022-superuser-role.js';

  // SQL-022 — CREATE/ALTER ROLE SUPERUSER.
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
    return SQL_022(r.ast);
  }

  describe('SQL-022 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on CREATE ROLE SUPERUSER', () => {
      const c = fire("CREATE ROLE backdoor SUPERUSER LOGIN PASSWORD 'x'");
      expect(c?.code).toBe('SQL-022');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on ALTER ROLE WITH SUPERUSER', () => {
      const c = fire("ALTER ROLE app_user WITH SUPERUSER");
      expect(c?.code).toBe('SQL-022');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on lowercase create role with superuser bypassrls', () => {
      const c = fire("create role evil with superuser bypassrls");
      expect(c?.code).toBe('SQL-022');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });
  });

  describe('SQL-022 — negative fixtures (must not fire)', () => {
    it('does not fire on CREATE ROLE without SUPERUSER', () => {
      expect(fire("CREATE ROLE app_user LOGIN PASSWORD 'x'")).toBeNull();
    });

  it('does not fire on ALTER ROLE WITH NOSUPERUSER', () => {
      expect(fire("ALTER ROLE app_user WITH NOSUPERUSER")).toBeNull();
    });

  it('does not fire on GRANT pg_read_all_data', () => {
      expect(fire("GRANT pg_read_all_data TO app_user")).toBeNull();
    });
  });

  describe('SQL-022 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("CREATE ROLE backdoor SUPERUSER LOGIN PASSWORD 'x'; DROP TABLE audit_log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-022');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("CREATE ROLE backdoor SUPERUSER LOGIN PASSWORD 'x'; DROP TABLE audit_log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  