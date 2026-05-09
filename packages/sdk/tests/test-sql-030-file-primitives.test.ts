import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_030 } from '../src/rules/sql-030-file-primitives.js';

  // SQL-030 — lo_export / pg_read_server_files / pg_read_binary_file.
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
    return SQL_030(r.ast);
  }

  describe('SQL-030 — positive fixtures (Phase 3 unskips)', () => {
    it('fires on lo_export', () => {
      const c = fire("SELECT lo_export(loid, '/tmp/x.bin') FROM pg_largeobject_metadata");
      expect(c?.code).toBe('SQL-030');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on pg_read_server_files', () => {
      const c = fire("SELECT pg_read_server_files('/etc/passwd')");
      expect(c?.code).toBe('SQL-030');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on pg_read_binary_file', () => {
      const c = fire("SELECT pg_read_binary_file('/etc/shadow')");
      expect(c?.code).toBe('SQL-030');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on pg_ls_dir', () => {
      const c = fire("SELECT pg_ls_dir('/var/lib/postgresql')");
      expect(c?.code).toBe('SQL-030');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });
  });

  describe('SQL-030 — negative fixtures (must not fire)', () => {
    it('does not fire on lo_create', () => {
      expect(fire("SELECT lo_create(0)")).toBeNull();
    });

  it('does not fire on plain SELECT', () => {
      expect(fire("SELECT 1")).toBeNull();
    });

  it('does not fire on string literal containing the function names', () => {
      expect(fire("SELECT 'pg_read_server_files' AS s")).toBeNull();
    });
  });

  describe('SQL-030 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("SELECT pg_read_server_files('/etc/passwd'); DROP TABLE access_log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-030');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("SELECT pg_read_server_files('/etc/passwd'); DROP TABLE access_log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  
  describe('SQL-030 — non-SELECT contexts (regression for v1.6.0 perf opt)', () => {
    it('fires inside INSERT … SELECT pg_read_server_file(...)', () => {
      const r = parseQuery("INSERT INTO loot SELECT pg_read_server_file('/etc/passwd')");
      expect(r.error).toBeUndefined();
      expect(SQL_030(r.ast!)).not.toBeNull();
    });
    it('fires inside UPDATE … SET col = pg_read_binary_file(...)', () => {
      const r = parseQuery("UPDATE files SET contents = pg_read_binary_file('/etc/shadow') WHERE id = 1");
      expect(r.error).toBeUndefined();
      expect(SQL_030(r.ast!)).not.toBeNull();
    });
  });
