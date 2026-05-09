import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_019 } from '../src/rules/sql-019-create-trigger.js';

  // SQL-019 — CREATE TRIGGER.
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
    return SQL_019(r.ast);
  }

  describe('SQL-019 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on CREATE TRIGGER BEFORE INSERT', () => {
      const c = fire("CREATE TRIGGER audit_trigger BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION log_event()");
      expect(c?.code).toBe('SQL-019');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(75);
    });

  it('fires on CREATE TRIGGER AFTER UPDATE', () => {
      const c = fire("CREATE TRIGGER backdoor AFTER UPDATE ON sensitive_table FOR EACH ROW EXECUTE FUNCTION evil()");
      expect(c?.code).toBe('SQL-019');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(75);
    });

  it('fires on CREATE OR REPLACE TRIGGER (Postgres 14+)', () => {
      const c = fire("CREATE OR REPLACE TRIGGER t BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION f()");
      expect(c?.code).toBe('SQL-019');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(75);
    });
  });

  describe('SQL-019 — negative fixtures (must not fire)', () => {
    it('does not fire on CREATE FUNCTION', () => {
      expect(fire("CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql")).toBeNull();
    });

  it('does not fire on CREATE EVENT TRIGGER (different AST)', () => {
      expect(fire("CREATE EVENT TRIGGER e ON ddl_command_start EXECUTE FUNCTION f()")).toBeNull();
    });

  it('does not fire on plain SELECT', () => {
      expect(fire("SELECT id FROM triggers")).toBeNull();
    });
  });

  describe('SQL-019 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("CREATE TRIGGER t BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION f(); DROP TABLE old_log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-019');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("CREATE TRIGGER t BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION f(); DROP TABLE old_log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  