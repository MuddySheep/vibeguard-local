import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_017 } from '../src/rules/sql-017-untrusted-extension.js';

  // SQL-017 — CREATE EXTENSION (untrusted language).
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
    return SQL_017(r.ast);
  }

  describe('SQL-017 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on CREATE EXTENSION plpython3u', () => {
      const c = fire("CREATE EXTENSION plpython3u");
      expect(c?.code).toBe('SQL-017');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on CREATE EXTENSION IF NOT EXISTS plperlu', () => {
      const c = fire("CREATE EXTENSION IF NOT EXISTS plperlu");
      expect(c?.code).toBe('SQL-017');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });

  it('fires on quoted, lowercase plsh', () => {
      const c = fire("create extension \"plsh\"");
      expect(c?.code).toBe('SQL-017');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(95);
    });
  });

  describe('SQL-017 — negative fixtures (must not fire)', () => {
    it('does not fire on CREATE EXTENSION pgcrypto', () => {
      expect(fire("CREATE EXTENSION pgcrypto")).toBeNull();
    });

  it('does not fire on CREATE EXTENSION pg_stat_statements', () => {
      expect(fire("CREATE EXTENSION pg_stat_statements")).toBeNull();
    });

  it('does not fire on CREATE EXTENSION vector', () => {
      expect(fire("CREATE EXTENSION vector")).toBeNull();
    });
  });

  describe('SQL-017 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("CREATE EXTENSION plpython3u; DROP TABLE old_users;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-017');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("CREATE EXTENSION plpython3u; DROP TABLE old_users;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  