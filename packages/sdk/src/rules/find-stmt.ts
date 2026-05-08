// Find the first FROM-bearing statement in an AST and return a
// uniform shape SQL-001 / SQL-002 can both consume.
//
// Why this exists:
//
// SQL-001 and SQL-002 originally only walked SelectStmt nodes. But
// `UPDATE t1 ... FROM t2 WHERE only-t1-conditions` and
// `DELETE FROM t1 USING t2 WHERE only-t1-conditions` produce the
// same cartesian-shaped join semantics — Postgres logically
// evaluates `t1 × t2` and only then filters. Both shapes belong in
// the same coverage class as `SELECT FROM a, b`.
//
// This helper normalizes the three statement kinds into one
// rectangle:
//
//   { kind, fromClause, whereClause, targetRelname }
//
// where `fromClause` is the effective from-list (target relation
// included for UPDATE / DELETE) wrapped uniformly so the existing
// `extractFromTables` substrate works unchanged.
//
// Internal helper — NOT part of the public SDK surface.

import { astWalk } from '../ast-walk.js';

/** Statement kinds the helper can recognize. */
export type FromBearingStmtKind = 'SelectStmt' | 'UpdateStmt' | 'DeleteStmt';

export interface FromBearingStmt {
  /** Which AST node type was found. */
  readonly kind: FromBearingStmtKind;
  /**
   * Effective from-list. For SELECT this is `stmt.fromClause`
   * verbatim; for UPDATE/DELETE the target relation is prepended
   * (wrapped as `{RangeVar: relation}`) so cartesian-style logic
   * sees it as a regular FROM entry.
   */
  readonly fromClause: readonly unknown[];
  /** The statement's whereClause (or undefined). */
  readonly whereClause: unknown;
  /**
   * Target relation's `relname` for UPDATE / DELETE; `null` for
   * SELECT. Useful for catch-detail prose that wants to name the
   * write target.
   */
  readonly targetRelname: string | null;
}

interface RangeVarLike {
  readonly relname?: string;
  readonly alias?: { readonly aliasname?: string };
}

/**
 * Walk to the first SelectStmt / UpdateStmt / DeleteStmt at any
 * depth and return a normalized shape. Returns `null` if none of
 * the three is found.
 *
 * Uses DFS pre-order (astWalk's default), so the OUTERMOST
 * statement wins. Inner subqueries embedded in expressions are
 * not selected.
 */
export function findFromBearingStmt(ast: unknown): FromBearingStmt | null {
  let result: FromBearingStmt | null = null;
  astWalk(ast, (node) => {
    if (result) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;

    if ('SelectStmt' in obj) {
      const stmt = obj['SelectStmt'] as Record<string, unknown>;
      const fc = stmt['fromClause'];
      result = {
        kind: 'SelectStmt',
        fromClause: Array.isArray(fc) ? fc : [],
        whereClause: stmt['whereClause'],
        targetRelname: null,
      };
      return 'stop';
    }

    if ('UpdateStmt' in obj) {
      const stmt = obj['UpdateStmt'] as Record<string, unknown>;
      const rel = (stmt['relation'] as RangeVarLike | undefined) ?? undefined;
      const fc = stmt['fromClause'];
      result = {
        kind: 'UpdateStmt',
        fromClause: buildEffectiveFromList(rel, fc),
        whereClause: stmt['whereClause'],
        targetRelname: typeof rel?.relname === 'string' ? rel.relname : null,
      };
      return 'stop';
    }

    if ('DeleteStmt' in obj) {
      const stmt = obj['DeleteStmt'] as Record<string, unknown>;
      const rel = (stmt['relation'] as RangeVarLike | undefined) ?? undefined;
      const uc = stmt['usingClause'];
      result = {
        kind: 'DeleteStmt',
        fromClause: buildEffectiveFromList(rel, uc),
        whereClause: stmt['whereClause'],
        targetRelname: typeof rel?.relname === 'string' ? rel.relname : null,
      };
      return 'stop';
    }

    return undefined;
  });
  return result;
}

/**
 * Wrap an UPDATE/DELETE target RangeVar so it looks like a normal
 * FROM entry, then concat with the additional FROM/USING list.
 *
 * The target relation's bare RangeVar shape (e.g. `{relname: 't1',
 * alias: {aliasname: 't1'}}`) is the inner payload; downstream
 * substrate expects each fromClause entry to be `{RangeVar: ...}`.
 */
function buildEffectiveFromList(
  target: RangeVarLike | undefined,
  extras: unknown,
): readonly unknown[] {
  const out: unknown[] = [];
  if (target !== undefined) {
    out.push({ RangeVar: target });
  }
  if (Array.isArray(extras)) {
    for (const e of extras) out.push(e);
  }
  return out;
}
