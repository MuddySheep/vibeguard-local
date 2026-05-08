import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_013 } from '../src/rules/sql-013-drop-truncate.js';

// V1.1 — SQL-013 destructive DDL tests.
// Distribution: positive cases per supported DDL kind, negative cases
// for the in-scope-but-bounded variants and out-of-scope DDL types,
// edge cases for adversarial / multi-target / qualified-name shapes.

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_013(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire (block, confidence 99) for destructive variants
// ----------------------------------------------------------------------

describe('SQL-013 — fires (block) on destructive DDL', () => {
  it('fires on DROP TABLE', () => {
    const c = fire('DROP TABLE users');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('block');
    expect(c?.confidence).toBe(99);
    expect(c?.title).toContain('DROP TABLE');
    expect(c?.detail).toContain('users');
    expect(c?.threatCategories).toContain('destruction');
  });

  it('fires on DROP TABLE IF EXISTS ... CASCADE', () => {
    const c = fire('DROP TABLE IF EXISTS users CASCADE');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('block');
    expect(c?.detail).toContain('CASCADE');
  });

  it('fires on DROP DATABASE', () => {
    const c = fire('DROP DATABASE production');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('block');
    expect(c?.title).toContain('DROP DATABASE');
    expect(c?.detail).toContain('production');
  });

  it('fires on DROP SCHEMA CASCADE', () => {
    const c = fire('DROP SCHEMA analytics CASCADE');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('block');
    expect(c?.detail).toContain('CASCADE');
    expect(c?.detail).toContain('analytics');
  });

  it('fires on DROP SCHEMA without CASCADE (still block)', () => {
    const c = fire('DROP SCHEMA reporting');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('block');
    expect(c?.detail).toContain('reporting');
  });

  it('fires on TRUNCATE TABLE', () => {
    const c = fire('TRUNCATE TABLE users');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('block');
    expect(c?.title).toContain('TRUNCATE');
    expect(c?.detail).toContain('users');
  });

  it('fires on bare TRUNCATE (TABLE keyword optional)', () => {
    const c = fire('TRUNCATE accounts');
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('accounts');
  });

  it('fires on TRUNCATE with multiple targets', () => {
    const c = fire('TRUNCATE users, accounts, orders');
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('users');
    expect(c?.detail).toContain('accounts');
    expect(c?.detail).toContain('orders');
  });

  it('fires on DROP TABLE with multiple targets (lists all names)', () => {
    const c = fire('DROP TABLE a, b, c');
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('a');
    expect(c?.detail).toContain('b');
    expect(c?.detail).toContain('c');
  });

  it('fires on schema-qualified DROP TABLE (public.users)', () => {
    const c = fire('DROP TABLE public.users');
    expect(c?.code).toBe('SQL-013');
    // dotted form preserved
    expect(c?.detail).toContain('public.users');
  });

  it('fires on schema-qualified TRUNCATE', () => {
    const c = fire('TRUNCATE public.users');
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('public.users');
  });
});

// ----------------------------------------------------------------------
// Positive — DROP INDEX fires at warn / 85
// ----------------------------------------------------------------------

describe('SQL-013 — fires (warn) on DROP INDEX', () => {
  it('fires at warn / 85 on DROP INDEX', () => {
    const c = fire('DROP INDEX idx_users_email');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(85);
    expect(c?.title).toBe('DROP INDEX');
    expect(c?.detail).toContain('idx_users_email');
  });

  it('fires at warn / 85 on DROP INDEX IF EXISTS', () => {
    const c = fire('DROP INDEX IF EXISTS idx_unused');
    expect(c?.code).toBe('SQL-013');
    expect(c?.severity).toBe('warn');
    expect(c?.detail).toContain('idx_unused');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire (out-of-scope DDL, bounded DML)
// ----------------------------------------------------------------------

describe('SQL-013 — does not fire on out-of-scope DDL', () => {
  it('does not fire on DROP VIEW (out of V1.1 scope)', () => {
    expect(fire('DROP VIEW user_summary')).toBeNull();
  });

  it('does not fire on DROP FUNCTION (out of V1.1 scope)', () => {
    expect(fire('DROP FUNCTION compute_total(int)')).toBeNull();
  });

  it('does not fire on DROP SEQUENCE (out of V1.1 scope)', () => {
    expect(fire('DROP SEQUENCE id_seq')).toBeNull();
  });

  it('does not fire on DROP TYPE (out of V1.1 scope)', () => {
    expect(fire('DROP TYPE status_enum')).toBeNull();
  });

  it('does not fire on ALTER TABLE ... DROP COLUMN (different stmt type)', () => {
    expect(fire('ALTER TABLE users DROP COLUMN deprecated_field')).toBeNull();
  });

  it('does not fire on CREATE TABLE (different stmt type entirely)', () => {
    expect(fire('CREATE TABLE users (id INT)')).toBeNull();
  });

  it('does not fire on bounded UPDATE (SQL-013 is DDL only)', () => {
    expect(fire('UPDATE users SET email = $1 WHERE id = 1')).toBeNull();
  });

  it('does not fire on DELETE (covered by SQL-003, not SQL-013)', () => {
    expect(fire('DELETE FROM users WHERE id = 1')).toBeNull();
  });

  it('does not fire on SELECT', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-013 — edge cases', () => {
  it('fires on first destructive stmt in a multi-statement script', () => {
    const c = fire('SELECT 1; DROP TABLE users; CREATE TABLE x (id INT)');
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('users');
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_013(cursor)).not.toThrow();
    expect(SQL_013(cursor)).toBeNull();
  });

  it('handles malformed DropStmt (missing objects field)', () => {
    const ast = {
      stmts: [
        {
          stmt: {
            DropStmt: {
              removeType: 'OBJECT_TABLE',
              behavior: 'DROP_RESTRICT',
            },
          },
        },
      ],
    };
    const c = SQL_013(ast);
    // Still fires — the threat is real even if we couldn't extract names.
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('<unknown>');
  });

  it('handles malformed DropdbStmt (missing dbname)', () => {
    const ast = {
      stmts: [{ stmt: { DropdbStmt: {} } }],
    };
    const c = SQL_013(ast);
    expect(c?.code).toBe('SQL-013');
    expect(c?.detail).toContain('<unknown>');
  });

  it('handles malformed TruncateStmt (missing relations)', () => {
    const ast = {
      stmts: [
        {
          stmt: {
            TruncateStmt: {
              behavior: 'DROP_RESTRICT',
            },
          },
        },
      ],
    };
    const c = SQL_013(ast);
    expect(c?.code).toBe('SQL-013');
  });
});

// ----------------------------------------------------------------------
// Output stability — STABILITY.md commitment
// ----------------------------------------------------------------------

describe('SQL-013 — output stability', () => {
  it('DROP TABLE canonical case has stable shape and confidence 99', () => {
    const c = fire('DROP TABLE users');
    expect(c).toMatchObject({
      code: 'SQL-013',
      severity: 'block',
      confidence: 99,
      threatCategories: ['destruction'],
    });
    expect(typeof c?.detail).toBe('string');
    expect(typeof c?.fix).toBe('string');
  });

  it('DROP INDEX canonical case has stable shape and confidence 85', () => {
    const c = fire('DROP INDEX idx_x');
    expect(c).toMatchObject({
      code: 'SQL-013',
      severity: 'warn',
      confidence: 85,
      threatCategories: ['destruction'],
    });
  });

  it('TRUNCATE canonical case is block / 99', () => {
    const c = fire('TRUNCATE users');
    expect(c).toMatchObject({
      code: 'SQL-013',
      severity: 'block',
      confidence: 99,
    });
  });
});
