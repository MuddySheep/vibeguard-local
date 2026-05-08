import { beforeAll, describe, expect, it, vi } from 'vitest';

import { astWalk, AST_WALK_MAX_DEPTH } from '../src/ast-walk.js';
import { extractColumns } from '../src/extract-columns.js';
import { extractFromTables } from '../src/extract-tables.js';
import { init, parseQuery } from '../src/parser.js';
import { runRules } from '../src/run-rules.js';
import type { Rule } from '../src/types.js';

// STORY 1.4 substrate tests. Coverage targets per CONTRIBUTING.md:
// each substrate file ≥95% line coverage. Tests below exercise:
//   - astWalk: order, skip, stop, max-depth, array-of-nodes, primitives
//   - extractFromTables: simple FROM, comma-separated, JOIN forms,
//     aliased, schema-qualified, subquery in FROM
//   - extractColumns: bare / qualified / schema-qualified / star / t.*
//   - runRules: empty registry, throw-safety, custom logger, output
//     order, multi-fire

beforeAll(async () => {
  await init();
});

// ----------------------------------------------------------------------
// astWalk
// ----------------------------------------------------------------------

describe('astWalk', () => {
  it('visits every object node in DFS order', () => {
    const tree = {
      a: { tag: 'A', child: { tag: 'B' } },
      c: [{ tag: 'C' }, { tag: 'D' }],
    };
    const visited: string[] = [];
    astWalk(tree, (node) => {
      const t = (node as { tag?: string }).tag;
      if (t) visited.push(t);
    });
    // Source-order: a → A → B → c → C → D
    expect(visited).toEqual(['A', 'B', 'C', 'D']);
  });

  it('respects skip — does not descend into pruned subtree', () => {
    const tree = { a: { tag: 'A', child: { tag: 'B' } }, c: { tag: 'C' } };
    const visited: string[] = [];
    astWalk(tree, (node) => {
      const t = (node as { tag?: string }).tag;
      if (t) visited.push(t);
      if (t === 'A') return 'skip';
      return undefined;
    });
    expect(visited).toEqual(['A', 'C']); // B not visited
  });

  it('respects stop — halts traversal entirely', () => {
    const tree = { a: { tag: 'A' }, b: { tag: 'B' }, c: { tag: 'C' } };
    const visited: string[] = [];
    astWalk(tree, (node) => {
      const t = (node as { tag?: string }).tag;
      if (t) visited.push(t);
      if (t === 'B') return 'stop';
      return undefined;
    });
    expect(visited).toEqual(['A', 'B']); // C not visited
  });

  it('passes the parent property name as `key`', () => {
    const tree = { fromClause: [{ kind: 'X' }], whereClause: { kind: 'Y' } };
    const seen: Array<{ key: string | null; kind: string | undefined }> = [];
    astWalk(tree, (node, key) => {
      const kind = (node as { kind?: string }).kind;
      if (kind) seen.push({ key, kind });
    });
    expect(seen).toEqual([
      { key: 'fromClause', kind: 'X' },
      { key: 'whereClause', kind: 'Y' },
    ]);
  });

  it('handles arrays of nodes', () => {
    const tree = { items: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    const seen: number[] = [];
    astWalk(tree, (node) => {
      const n = (node as { n?: number }).n;
      if (typeof n === 'number') seen.push(n);
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('skips primitives, null, and undefined', () => {
    const tree = { a: 1, b: 'str', c: null, d: undefined, e: { tag: 'E' } };
    const visited: string[] = [];
    astWalk(tree, (node) => {
      const t = (node as { tag?: string }).tag;
      if (t) visited.push(t);
    });
    expect(visited).toEqual(['E']);
  });

  it('halts cleanly at MAX_DEPTH without crashing', () => {
    // Build a chain of nested objects MAX_DEPTH+10 deep.
    const root: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < AST_WALK_MAX_DEPTH + 10; i++) {
      const next: Record<string, unknown> = { tag: `n${i}` };
      cursor['child'] = next;
      cursor = next;
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const visited: string[] = [];
    expect(() =>
      astWalk(root, (node) => {
        const t = (node as { tag?: string }).tag;
        if (t) visited.push(t);
      }),
    ).not.toThrow();
    // Visited at most MAX_DEPTH-many tagged nodes (off-by-one tolerated).
    expect(visited.length).toBeLessThanOrEqual(AST_WALK_MAX_DEPTH + 1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats arrays themselves as transparent (visits items, not array)', () => {
    const tree = [{ tag: 'A' }, { tag: 'B' }];
    const visited: string[] = [];
    astWalk(tree, (node) => {
      const t = (node as { tag?: string }).tag;
      if (t) visited.push(t);
    });
    // Top-level passed array is visited as a node (visitor sees it),
    // but its `tag` is undefined so no push. Items are visited next.
    expect(visited).toEqual(['A', 'B']);
  });
});

// ----------------------------------------------------------------------
// extractFromTables
// ----------------------------------------------------------------------

describe('extractFromTables', () => {
  function tablesOf(sql: string) {
    const r = parseQuery(sql);
    expect(r.error).toBeUndefined();
    return extractFromTables(r.ast);
  }

  it('extracts a simple FROM (one table)', () => {
    const t = tablesOf('SELECT * FROM users');
    expect(t).toEqual([{ name: 'users' }]);
  });

  it('extracts comma-separated FROM (cartesian shape)', () => {
    const t = tablesOf('SELECT * FROM a, b');
    expect(t.map((x) => x.name)).toEqual(['a', 'b']);
  });

  it('extracts JOIN form', () => {
    const t = tablesOf('SELECT * FROM users JOIN orders ON users.id = orders.user_id');
    expect(t.map((x) => x.name).sort()).toEqual(['orders', 'users']);
  });

  it('extracts aliased tables', () => {
    const t = tablesOf('SELECT u.id FROM users u');
    expect(t).toEqual([{ name: 'users', alias: 'u' }]);
  });

  it('extracts schema-qualified tables', () => {
    const t = tablesOf('SELECT * FROM public.users');
    expect(t).toEqual([{ name: 'users', schema: 'public' }]);
  });

  it('extracts subqueries in FROM (with isSubquery flag)', () => {
    const t = tablesOf('SELECT sub.x FROM (SELECT 1 AS x) sub');
    expect(t).toEqual([{ name: '', isSubquery: true, alias: 'sub' }]);
  });

  it('handles LEFT JOIN', () => {
    const t = tablesOf(
      'SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id',
    );
    expect(t.map((x) => x.alias).sort()).toEqual(['o', 'u']);
  });

  it('handles three-way JOIN', () => {
    const t = tablesOf(
      'SELECT * FROM a JOIN b ON a.id = b.a_id JOIN c ON b.id = c.b_id',
    );
    expect(t.map((x) => x.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for SELECT without FROM', () => {
    const t = tablesOf('SELECT 1');
    expect(t).toEqual([]);
  });

  it('extracts target table from UPDATE', () => {
    const t = tablesOf('UPDATE users SET email = $1 WHERE id = $2');
    expect(t.find((x) => x.name === 'users')).toBeDefined();
  });

  it('extracts target table from DELETE', () => {
    const t = tablesOf('DELETE FROM users WHERE id = $1');
    expect(t.find((x) => x.name === 'users')).toBeDefined();
  });
});

// ----------------------------------------------------------------------
// extractColumns
// ----------------------------------------------------------------------

describe('extractColumns', () => {
  function columnsOf(sql: string) {
    const r = parseQuery(sql);
    expect(r.error).toBeUndefined();
    return extractColumns(r.ast);
  }

  it('extracts a bare column reference', () => {
    const c = columnsOf('SELECT email FROM users');
    expect(c).toContainEqual({ name: 'email' });
  });

  it('extracts a qualified t.col reference', () => {
    const c = columnsOf('SELECT u.email FROM users u');
    expect(c).toContainEqual({ name: 'email', table: 'u' });
  });

  it('extracts a schema-qualified s.t.col reference', () => {
    const c = columnsOf('SELECT public.users.email FROM public.users');
    expect(c).toContainEqual({
      name: 'email',
      table: 'users',
      schema: 'public',
    });
  });

  it('extracts a star reference', () => {
    const c = columnsOf('SELECT * FROM users');
    expect(c).toContainEqual({ name: '*' });
  });

  it('extracts a t.* reference', () => {
    const c = columnsOf('SELECT u.* FROM users u');
    expect(c).toContainEqual({ name: '*', table: 'u' });
  });

  it('extracts column refs from WHERE clause', () => {
    const c = columnsOf('SELECT 1 FROM users WHERE active = true');
    expect(c.find((x) => x.name === 'active')).toBeDefined();
  });

  it('preserves order and duplicates', () => {
    const c = columnsOf('SELECT id, id FROM users');
    expect(c.filter((x) => x.name === 'id')).toHaveLength(2);
  });

  it('returns [] for SQL with no column references', () => {
    const c = columnsOf("SELECT 1, 'literal'");
    expect(c).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// runRules
// ----------------------------------------------------------------------

describe('runRules', () => {
  it('returns [] for an empty rule registry', () => {
    expect(runRules({}, [])).toEqual([]);
  });

  it('aggregates non-null catches in registry order', () => {
    const ruleA: Rule = () => ({
      code: 'SQL-A',
      title: 'A',
      severity: 'info',
      confidence: 50,
      detail: 'd',
      fix: 'f',
      threatCategories: ['integrity'],
    });
    const ruleSilent: Rule = () => null;
    const ruleB: Rule = () => ({
      code: 'SQL-B',
      title: 'B',
      severity: 'warn',
      confidence: 70,
      detail: 'd',
      fix: 'f',
      threatCategories: ['corruption'],
    });
    const out = runRules({}, [ruleA, ruleSilent, ruleB]);
    expect(out.map((c) => c.code)).toEqual(['SQL-A', 'SQL-B']);
  });

  it('skips throwing rules and continues with remaining', () => {
    const ruleThrows: Rule = () => {
      throw new Error('boom');
    };
    const ruleOK: Rule = () => ({
      code: 'SQL-OK',
      title: 'OK',
      severity: 'info',
      confidence: 60,
      detail: 'd',
      fix: 'f',
      threatCategories: ['integrity'],
    });
    const errors: Array<{ msg: string; err: unknown }> = [];
    const out = runRules({}, [ruleThrows, ruleOK], {
      logger: { error: (msg, err) => errors.push({ msg, err }) },
    });
    expect(out.map((c) => c.code)).toEqual(['SQL-OK']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.msg).toContain('rule threw');
  });

  it('uses console.error when no logger is supplied', () => {
    const ruleThrows: Rule = () => {
      throw new Error('boom');
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = runRules({}, [ruleThrows]);
    expect(out).toEqual([]);
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });

  it('does not log on rules that legitimately return null', () => {
    const ruleSilent: Rule = () => null;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runRules({}, [ruleSilent]);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
