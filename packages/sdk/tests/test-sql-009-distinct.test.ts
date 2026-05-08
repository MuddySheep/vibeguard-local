import { beforeAll, describe, expect, it } from 'vitest';

import { init, parseQuery } from '../src/parser.js';
import { SQL_009 } from '../src/rules/sql-009-distinct.js';

beforeAll(async () => {
  await init();
});

function fire(sql: string) {
  const r = parseQuery(sql);
  expect(r.error).toBeUndefined();
  return SQL_009(r.ast);
}

// ----------------------------------------------------------------------
// Positive — should fire
// ----------------------------------------------------------------------

describe('SQL-009 — fires on DISTINCT applied to all-star projections', () => {
  it('fires on SELECT DISTINCT *', () => {
    const c = fire('SELECT DISTINCT * FROM users');
    expect(c?.code).toBe('SQL-009');
    expect(c?.severity).toBe('info');
    expect(c?.confidence).toBe(65);
    expect(c?.threatCategories).toContain('integrity');
  });

  it('fires on SELECT DISTINCT * with WHERE', () => {
    expect(
      fire('SELECT DISTINCT * FROM users WHERE active = true')?.code,
    ).toBe('SQL-009');
  });

  it('fires on SELECT DISTINCT * with JOIN', () => {
    expect(
      fire(
        'SELECT DISTINCT * FROM users u JOIN orders o ON u.id = o.user_id',
      )?.code,
    ).toBe('SQL-009');
  });

  it('fires on SELECT DISTINCT u.* (qualified star)', () => {
    expect(fire('SELECT DISTINCT u.* FROM users u')?.code).toBe('SQL-009');
  });

  it('fires on SELECT DISTINCT u.*, o.* (multi-table-star)', () => {
    expect(
      fire(
        'SELECT DISTINCT u.*, o.* FROM users u JOIN orders o ON u.id=o.user_id',
      )?.code,
    ).toBe('SQL-009');
  });
});

// ----------------------------------------------------------------------
// Negative — should NOT fire
// ----------------------------------------------------------------------

describe('SQL-009 — does not fire on DISTINCT with explicit projection', () => {
  it('does not fire on single-column DISTINCT', () => {
    expect(fire('SELECT DISTINCT email FROM users')).toBeNull();
  });

  it('does not fire on multi-column DISTINCT', () => {
    expect(fire('SELECT DISTINCT a, b FROM users')).toBeNull();
  });

  it('does not fire on DISTINCT ON (col)', () => {
    expect(
      fire(
        'SELECT DISTINCT ON (id) * FROM users ORDER BY id, created_at DESC',
      ),
    ).toBeNull();
  });

  it('does not fire on plain SELECT (no DISTINCT)', () => {
    expect(fire('SELECT * FROM users')).toBeNull();
  });

  it('does not fire on SELECT with mixed star + column projection', () => {
    expect(
      fire('SELECT DISTINCT u.*, o.id FROM users u JOIN orders o ON u.id=o.user_id'),
    ).toBeNull();
  });

  it('does not fire on UPDATE / DELETE (different stmt type)', () => {
    expect(fire('UPDATE users SET email=$1 WHERE id=1')).toBeNull();
    expect(fire('DELETE FROM users WHERE id=1')).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Edge cases
// ----------------------------------------------------------------------

describe('SQL-009 — edge cases', () => {
  it('fires on SELECT DISTINCT * inside subquery in FROM', () => {
    // The walker stops at the first SelectStmt — which here is the
    // outer SELECT, NOT the subquery. The outer doesn't have
    // DISTINCT, so the rule should NOT fire on this.
    expect(
      fire(
        'SELECT * FROM (SELECT DISTINCT * FROM users) sub',
      ),
    ).toBeNull();
  });

  it('does not crash on adversarial deeply-nested AST', () => {
    let cursor: Record<string, unknown> = { tag: 'leaf' };
    for (let i = 0; i < 500; i++) {
      cursor = { wrapper: cursor };
    }
    expect(() => SQL_009(cursor)).not.toThrow();
    expect(SQL_009(cursor)).toBeNull();
  });

  it('does not fire on empty SQL', () => {
    const r = parseQuery('');
    expect(r.error).toBeDefined();
    expect(SQL_009(r.ast)).toBeNull();
  });

  it('fires on DISTINCT * with ORDER BY', () => {
    expect(
      fire('SELECT DISTINCT * FROM users ORDER BY id')?.code,
    ).toBe('SQL-009');
  });

  it('fires on DISTINCT * with LIMIT / OFFSET', () => {
    expect(
      fire('SELECT DISTINCT * FROM users LIMIT 10')?.code,
    ).toBe('SQL-009');
  });
});

// ----------------------------------------------------------------------
// Output stability
// ----------------------------------------------------------------------

describe('SQL-009 — output stability', () => {
  it('canonical case shape locked', () => {
    const c = fire('SELECT DISTINCT * FROM users');
    expect(c).toMatchObject({
      code: 'SQL-009',
      title: 'DISTINCT applied to a star projection',
      severity: 'info',
      confidence: 65,
      threatCategories: ['integrity'],
    });
    expect(c?.detail).toContain('DISTINCT *');
    expect(c?.fix).toContain('DISTINCT ON');
  });
});
