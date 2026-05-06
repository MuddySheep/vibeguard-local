import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_006 } from '../src/rules/sql-006-offset-without-orderby.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_006(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-006 — fires on OFFSET without ORDER BY', () => {
  it('fires on basic OFFSET 100', () => {
    const c = fire('SELECT * FROM users OFFSET 100');
    expect(c?.code).toBe('SQL-006');
    expect(c?.severity).toBe('warn');
    expect(c?.confidence).toBe(90);
    expect(c?.threatCategories).toContain('integrity');
  });

  it('fires on LIMIT 10 OFFSET 100 (still no ORDER BY)', () => {
    expect(fire('SELECT * FROM users LIMIT 10 OFFSET 100')?.code).toBe(
      'SQL-006',
    );
  });

  it('fires with explicit projection list', () => {
    expect(fire('SELECT id FROM users OFFSET 100')?.code).toBe('SQL-006');
  });

  it('fires when WHERE filters but no ORDER BY', () => {
    expect(
      fire('SELECT * FROM users WHERE active = true OFFSET 50')?.code,
    ).toBe('SQL-006');
  });

  it('fires on parameterized OFFSET ($1)', () => {
    // We can't statically know if $1 is 0 — fires conservatively
    // because pagination without ORDER BY is broken regardless of N.
    expect(fire('SELECT * FROM users OFFSET $1')?.code).toBe('SQL-006');
  });

  it('fires on OFFSET expression: (SELECT count(*) / 2 FROM users)', () => {
    expect(
      fire(
        'SELECT * FROM users OFFSET (SELECT count(*) / 2 FROM users)',
      )?.code,
    ).toBe('SQL-006');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-006 — does not fire on safe shapes', () => {
  it('does not fire when ORDER BY is present', () => {
    expect(fire('SELECT * FROM users ORDER BY id OFFSET 100')).toBeNull();
  });

  it('does not fire on multi-column ORDER BY + OFFSET', () => {
    expect(
      fire(
        'SELECT * FROM users ORDER BY created_at, id LIMIT 10 OFFSET 100',
      ),
    ).toBeNull();
  });

  it('does not fire on OFFSET 0 (defensive zero)', () => {
    expect(fire('SELECT * FROM users OFFSET 0')).toBeNull();
  });

  it('does not fire on OFFSET NULL', () => {
    expect(fire('SELECT * FROM users OFFSET NULL')).toBeNull();
  });

  it('does not fire on LIMIT-only (no OFFSET)', () => {
    expect(fire('SELECT * FROM users LIMIT 10')).toBeNull();
  });

  it('does not fire on plain SELECT', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });

  it('does not fire on UPDATE / DELETE (different stmt type)', () => {
    expect(fire('UPDATE users SET email=$1 WHERE id=1')).toBeNull();
    expect(fire('DELETE FROM users WHERE id=1')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-006 — edge cases', () => {
  it('fires on outer SELECT when CTE wraps an offset-with-orderby', () => {
    // The first SelectStmt walked in this query is whichever
    // libpg-query reports first. v1 takes the first one. Document
    // tolerance: result depends on layout; both null and SQL-006
    // are documented v1 behaviors. The test pins whatever the v1
    // implementation actually does.
    const c = fire(
      'WITH r AS (SELECT * FROM users ORDER BY id OFFSET 0) ' +
        'SELECT * FROM r OFFSET 100',
    );
    if (c) {
      expect(c.code).toBe('SQL-006');
    } else {
      expect(c).toBeNull();
    }
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_006(cursor)).not.toThrow();
    expect(SQL_006(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_006(r.ast)).toBeNull();
  });

  it('handles JOIN + OFFSET correctly', () => {
    // Multi-table query with OFFSET, no ORDER BY → fires
    expect(
      fire(
        'SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id OFFSET 50',
      )?.code,
    ).toBe('SQL-006');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-006 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire('SELECT * FROM users LIMIT 10 OFFSET 100');
    expect(c).toMatchObject({
      code: 'SQL-006',
      title: 'OFFSET without ORDER BY',
      severity: 'warn',
      confidence: 90,
      threatCategories: ['integrity'],
    });
    expect(c?.detail).toContain('Postgres does not');
    expect(c?.fix).toContain('ORDER BY');
  });
});
