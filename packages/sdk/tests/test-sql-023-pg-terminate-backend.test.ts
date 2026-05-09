import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_023 } from '../src/rules/sql-023-pg-terminate-backend.js';

  // SQL-023 — pg_terminate_backend / pg_cancel_backend.
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
    return SQL_023(r.ast);
  }

  describe('SQL-023 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on pg_terminate_backend over pg_stat_activity', () => {
      const c = fire("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid()");
      expect(c?.code).toBe('SQL-023');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(85);
    });

  it('fires on pg_cancel_backend literal pid', () => {
      const c = fire("SELECT pg_cancel_backend(12345)");
      expect(c?.code).toBe('SQL-023');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(85);
    });

  it('fires on lowercase pg_terminate_backend', () => {
      const c = fire("select pg_terminate_backend(pid) from pg_stat_activity");
      expect(c?.code).toBe('SQL-023');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(85);
    });
  });

  describe('SQL-023 — negative fixtures (must not fire)', () => {
    it('does not fire on pg_backend_pid', () => {
      expect(fire("SELECT pg_backend_pid()")).toBeNull();
    });

  it('does not fire on read-only pg_stat_activity SELECT', () => {
      expect(fire("SELECT pid FROM pg_stat_activity")).toBeNull();
    });

  it('does not fire on string literal containing the function name', () => {
      expect(fire("SELECT 'pg_terminate_backend' AS func_name")).toBeNull();
    });
  });

  describe('SQL-023 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("SELECT pg_terminate_backend(pid) FROM pg_stat_activity; DROP TABLE sessions;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-023');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("SELECT pg_terminate_backend(pid) FROM pg_stat_activity; DROP TABLE sessions;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  
  describe('SQL-023 — non-SELECT contexts (regression for v1.6.0 perf opt)', () => {
    it('fires inside INSERT … SELECT pg_terminate_backend(...)', () => {
      const r = parseQuery('INSERT INTO logs SELECT pg_terminate_backend(pid) FROM pg_stat_activity');
      expect(r.error).toBeUndefined();
      expect(SQL_023(r.ast!)).not.toBeNull();
    });
    it('fires inside UPDATE … SET col = pg_cancel_backend(...)', () => {
      const r = parseQuery('UPDATE jobs SET cancelled = pg_cancel_backend(pid) WHERE id = 1');
      expect(r.error).toBeUndefined();
      expect(SQL_023(r.ast!)).not.toBeNull();
    });
  });
