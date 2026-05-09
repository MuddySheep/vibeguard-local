import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_018 } from '../src/rules/sql-018-drop-column.js';

  // SQL-018 — ALTER TABLE DROP COLUMN.
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
    return SQL_018(r.ast);
  }

  describe('SQL-018 — positive fixtures (Phase 2 unskips)', () => {
    it('fires on DROP COLUMN', () => {
      const c = fire("ALTER TABLE users DROP COLUMN email");
      expect(c?.code).toBe('SQL-018');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on DROP COLUMN CASCADE', () => {
      const c = fire("ALTER TABLE users DROP COLUMN email CASCADE");
      expect(c?.code).toBe('SQL-018');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });

  it('fires on lowercase quoted column', () => {
      const c = fire("alter table users drop column if exists \"Email\"");
      expect(c?.code).toBe('SQL-018');
      expect(c?.severity).toBe('warn');
      expect(c?.confidence).toBe(90);
    });
  });

  describe('SQL-018 — negative fixtures (must not fire)', () => {
    it('does not fire on ADD COLUMN', () => {
      expect(fire("ALTER TABLE users ADD COLUMN email text")).toBeNull();
    });

  it('does not fire on ALTER COLUMN SET NOT NULL', () => {
      expect(fire("ALTER TABLE users ALTER COLUMN email SET NOT NULL")).toBeNull();
    });

  it('does not fire on RENAME COLUMN', () => {
      expect(fire("ALTER TABLE users RENAME COLUMN email TO email_addr")).toBeNull();
    });
  });

  describe('SQL-018 — multi-statement composition with SQL-003', () => {
    it('the new rule fires alongside SQL-003', () => {
      const result = analyze("ALTER TABLE users DROP COLUMN email; UPDATE users SET active = false;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-018');
      expect(codes).toContain('SQL-003');
    });

    it('SQL-003 still fires when the placeholder is in registry', () => {
      const result = analyze("ALTER TABLE users DROP COLUMN email; UPDATE users SET active = false;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-003');
    });
  });
  