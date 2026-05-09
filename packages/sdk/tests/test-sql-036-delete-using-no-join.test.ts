import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_036 } from '../src/rules/sql-036-delete-using-no-join.js';

  // SQL-036 — DELETE … USING without join predicate.
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
    return SQL_036(r.ast);
  }

  describe('SQL-036 — positive fixtures (Phase 5 unskips)', () => {
    it('fires on DELETE USING (no WHERE)', () => {
      const c = fire("DELETE FROM users USING orders");
      expect(c?.code).toBe('SQL-036');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });

  it('fires when WHERE only references target', () => {
      const c = fire("DELETE FROM users u USING orders o WHERE u.active");
      expect(c?.code).toBe('SQL-036');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });

  it('fires on lowercase delete using, no where', () => {
      const c = fire("delete from users using orders");
      expect(c?.code).toBe('SQL-036');
      expect(c?.severity).toBe('block');
      expect(c?.confidence).toBe(90);
    });
  });

  describe('SQL-036 — negative fixtures (must not fire)', () => {
    it('does not fire on proper join predicate', () => {
      expect(fire("DELETE FROM users u USING orders o WHERE u.id = o.user_id AND o.fraud")).toBeNull();
    });

  it('does not fire on DELETE without USING (handled by SQL-003)', () => {
      expect(fire("DELETE FROM users WHERE id = 42")).toBeNull();
    });

  it('does not fire on plain SELECT', () => {
      expect(fire("SELECT * FROM users")).toBeNull();
    });
  });

  describe('SQL-036 — multi-statement composition with SQL-013', () => {
    it('the new rule fires alongside SQL-013', () => {
      const result = analyze("DELETE FROM users USING orders; DROP TABLE log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-036');
      expect(codes).toContain('SQL-013');
    });

    it('SQL-013 still fires when the placeholder is in registry', () => {
      const result = analyze("DELETE FROM users USING orders; DROP TABLE log;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-013');
    });
  });
  