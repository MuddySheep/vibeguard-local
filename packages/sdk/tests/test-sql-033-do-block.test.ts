import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_033 } from '../src/rules/sql-033-do-block.js';

  // SQL-033 — DO $$ ... $$ block (unparsed body).
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
    return SQL_033(r.ast);
  }

  describe('SQL-033 — positive fixtures (Phase 4 unskips)', () => {
    it('fires on DO $$ BEGIN DELETE ... END $$', () => {
      const c = fire("DO $$ BEGIN DELETE FROM users; END $$");
      expect(c?.code).toBe('SQL-033');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(70);
    });

  it('fires on DO LANGUAGE plpgsql', () => {
      const c = fire("DO LANGUAGE plpgsql $$ BEGIN PERFORM 1; END $$");
      expect(c?.code).toBe('SQL-033');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(70);
    });

  it('fires on DO with PERFORM dblink_connect', () => {
      const c = fire("DO $$ BEGIN PERFORM dblink_connect('host=x'); END $$");
      expect(c?.code).toBe('SQL-033');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(70);
    });
  });

  describe('SQL-033 — negative fixtures (must not fire)', () => {
    it('does not fire on string containing \'DO\'', () => {
      expect(fire("SELECT * FROM users WHERE name = 'do'")).toBeNull();
    });

  it('does not fire on CREATE FUNCTION (different AST)', () => {
      expect(fire("CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql")).toBeNull();
    });

  it('does not fire on plain SELECT', () => {
      expect(fire("SELECT 1")).toBeNull();
    });
  });

  describe('SQL-033 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("DO $$ BEGIN DELETE FROM users; END $$; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-033');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("DO $$ BEGIN DELETE FROM users; END $$; DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  