import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_020 } from '../src/rules/sql-020-create-or-replace-function.js';

  // SQL-020 — CREATE OR REPLACE FUNCTION (overwrite signal).
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
    return SQL_020(r.ast);
  }

  describe('SQL-020 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on CREATE OR REPLACE FUNCTION', () => {
      const c = fire("CREATE OR REPLACE FUNCTION audit_check() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql");
      expect(c?.code).toBe('SQL-020');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(70);
    });

  it('fires on CREATE OR REPLACE FUNCTION with args', () => {
      const c = fire("CREATE OR REPLACE FUNCTION foo(int) RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql");
      expect(c?.code).toBe('SQL-020');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(70);
    });

  it('fires on lowercase create or replace', () => {
      const c = fire("create or replace function bar() returns void as $$ begin end $$ language plpgsql");
      expect(c?.code).toBe('SQL-020');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(70);
    });
  });

  describe('SQL-020 — negative fixtures (must not fire)', () => {
    it('does not fire on plain CREATE FUNCTION', () => {
      expect(fire("CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql")).toBeNull();
    });

  it('does not fire on CREATE OR REPLACE VIEW', () => {
      expect(fire("CREATE OR REPLACE VIEW v AS SELECT id FROM users")).toBeNull();
    });

  it('does not fire on DROP FUNCTION', () => {
      expect(fire("DROP FUNCTION foo()")).toBeNull();
    });
  });

  describe('SQL-020 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-020');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  