import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_035 } from '../src/rules/sql-035-update-from-no-join.js';

  // SQL-035 — UPDATE … FROM without join predicate.
  //
  // Phase 1 scaffolding tests:
  //   - Positive fixtures are `it.skip`'d. They become live in Phase 5
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
    return SQL_035(r.ast);
  }

  describe('SQL-035 — positive fixtures (Phase 5 unskips)', () => {
    it('fires on UPDATE ... FROM ... (no WHERE)', () => {
      const c = fire("UPDATE users SET status = 'x' FROM orders");
      expect(c?.code).toBe('SQL-035');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });

  it('fires when WHERE only references target', () => {
      const c = fire("UPDATE users u SET status = 'x' FROM orders o WHERE u.active");
      expect(c?.code).toBe('SQL-035');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });

  it('fires on UPDATE FROM multiple tables, no WHERE', () => {
      const c = fire("UPDATE u SET status = 'x' FROM users u, orders o");
      expect(c?.code).toBe('SQL-035');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });
  });

  describe('SQL-035 — negative fixtures (must not fire)', () => {
    it('does not fire on proper join predicate', () => {
      expect(fire("UPDATE users u SET status = 'x' FROM orders o WHERE u.id = o.user_id")).toBeNull();
    });

  it('does not fire on UPDATE with no FROM (handled by SQL-003)', () => {
      expect(fire("UPDATE users SET active = false WHERE id = 42")).toBeNull();
    });

  it('does not fire on plain SELECT', () => {
      expect(fire("SELECT * FROM users")).toBeNull();
    });
  });

  describe('SQL-035 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("UPDATE users u SET s = 'x' FROM orders o; DROP TABLE backup;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-035');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("UPDATE users u SET s = 'x' FROM orders o; DROP TABLE backup;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  