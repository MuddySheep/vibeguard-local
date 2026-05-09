import { beforeAll, describe, expect, it } from 'vitest';

  import { analyze, init } from '../src/index.js';
  import { parseQuery } from '../src/parser.js';
  import { SQL_031 } from '../src/rules/sql-031-on-conflict-do-update.js';

  // SQL-031 — INSERT ON CONFLICT DO UPDATE (mass overwrite).
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
    return SQL_031(r.ast);
  }

  describe('SQL-031 — positive fixtures (Phase 4 unskips)', () => {
    it('fires on INSERT SELECT ... ON CONFLICT DO UPDATE', () => {
      const c = fire("INSERT INTO users (id, email) SELECT id, 'x' FROM users ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email");
      expect(c?.code).toBe('SQL-031');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(75);
    });

  it('fires on INSERT SELECT * ... ON CONFLICT DO UPDATE', () => {
      const c = fire("INSERT INTO settings (id, value) SELECT id, value FROM other_settings ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value");
      expect(c?.code).toBe('SQL-031');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(75);
    });

  it('fires on lowercase', () => {
      const c = fire("insert into users (id, email) select id, 'x' from users on conflict (id) do update set email = excluded.email");
      expect(c?.code).toBe('SQL-031');
      expect(c?.severity).toBe('info');
      expect(c?.confidence).toBe(75);
    });
  });

  describe('SQL-031 — negative fixtures (must not fire)', () => {
    it('does not fire on single-row VALUES INSERT ON CONFLICT DO UPDATE', () => {
      expect(fire("INSERT INTO users (id, email) VALUES (1, 'a@b.c') ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email")).toBeNull();
    });

  it('does not fire when bounded by LIMIT', () => {
      expect(fire("INSERT INTO users (id, email) SELECT id, email FROM new_users LIMIT 100 ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email")).toBeNull();
    });

  it('does not fire on ON CONFLICT DO NOTHING', () => {
      expect(fire("INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING")).toBeNull();
    });
  });

  describe('SQL-031 — multi-statement composition with SQL-003', () => {
    it('the new rule fires alongside SQL-003', () => {
      const result = analyze("INSERT INTO users (id, email) SELECT id, 'x' FROM users ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email; UPDATE users SET active = false;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-031');
      expect(codes).toContain('SQL-003');
    });

    it('SQL-003 still fires when the placeholder is in registry', () => {
      const result = analyze("INSERT INTO users (id, email) SELECT id, 'x' FROM users ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email; UPDATE users SET active = false;");
      const codes = result.catches.map((c) => c.code);
      expect(codes).toContain('SQL-003');
    });
  });
  