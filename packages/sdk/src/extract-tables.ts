// Extract table references from a SelectStmt / UpdateStmt / DeleteStmt.
//
// Returns one entry per real RangeVar in the statement's FROM-shaped
// clauses (`fromClause` for SELECT, `relation` + USING for UPDATE/DELETE).
// JoinExpr is recursively descended into. Subqueries inside FROM
// (`RangeSubselect`) are returned with `isSubquery: true` and an empty
// `name` — rules can decide whether to treat them as opaque or descend
// into the subquery themselves.
//
// CTEs (`WITH x AS (...)`) and lateral joins are intentionally not
// special-cased here — the AST shape treats them as regular RangeVars
// after binding, and rules that need CTE-aware behavior can use the
// substrate `astWalk` directly.

import { astWalk } from './ast-walk.js';

/**
 * One table reference pulled from a FROM-shaped clause.
 */
export interface FromTable {
  /** Table name (libpg-query `relname`). Empty string for subquery sources. */
  readonly name: string;
  /** Schema qualifier if present (e.g. "public" in `FROM public.users`). */
  readonly schema?: string;
  /** Alias if present (e.g. "u" in `FROM users u`). */
  readonly alias?: string;
  /** True iff this entry came from a subquery in FROM (RangeSubselect). */
  readonly isSubquery?: boolean;
}

interface RangeVarLike {
  readonly relname?: string;
  readonly schemaname?: string;
  readonly alias?: { readonly aliasname?: string };
}

interface RangeSubselectLike {
  readonly alias?: { readonly aliasname?: string };
  readonly subquery?: unknown;
}

/**
 * Walk the supplied node (typically a `SelectStmt` / `UpdateStmt` /
 * `DeleteStmt` body) and yield all table references reachable through
 * its FROM-shaped clauses.
 *
 * Implementation: collect every RangeVar / RangeSubselect node found
 * under any property whose key indicates a FROM-shaped clause
 * (`fromClause`, `relation`, `usingClause`, `larg`, `rarg`). This
 * matches the libpg-query shape across SelectStmt / UpdateStmt /
 * DeleteStmt without needing per-statement-type dispatch logic.
 *
 * @param stmt - typically `result.stmts[i].stmt` or one of its inner
 *               statement bodies. Tolerates a wider input shape: passing
 *               the full parser result also works (will find all
 *               RangeVars in any contained statement).
 */
export function extractFromTables(stmt: unknown): FromTable[] {
  const tables: FromTable[] = [];

  astWalk(stmt, (node, key) => {
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;

    // Wrapped RangeVar — appears in fromClause / JoinExpr.larg / .rarg
    // as `{ RangeVar: { relname, schemaname?, alias? } }`.
    if ('RangeVar' in obj && isFromShapedKey(key)) {
      const rv = obj['RangeVar'] as RangeVarLike;
      tables.push(buildFromTable(rv));
      return undefined;
    }

    // Bare RangeVar — appears in UpdateStmt.relation / DeleteStmt.relation
    // / InsertStmt.relation directly, without the `{ RangeVar: ... }`
    // wrapper. We detect it by the parent key being "relation" and the
    // node having a `relname` string.
    if (key === 'relation' && typeof obj['relname'] === 'string') {
      tables.push(buildFromTable(obj as RangeVarLike));
      return undefined;
    }

    // RangeSubselect — subquery in FROM (always wrapped).
    if ('RangeSubselect' in obj && isFromShapedKey(key)) {
      const rs = obj['RangeSubselect'] as RangeSubselectLike;
      const entry: FromTable = {
        name: '',
        isSubquery: true,
        ...(typeof rs.alias?.aliasname === 'string'
          ? { alias: rs.alias.aliasname }
          : {}),
      };
      tables.push(entry);
      return undefined;
    }

    // JoinExpr / other intermediate nodes — descend naturally via
    // the walker; nothing to do here.
    return undefined;
  });

  return tables;
}

// Property names that indicate "this position holds a table reference."
// Wrapped RangeVars (`{ RangeVar: {...} }`) appear inside these.
// Bare RangeVars (UPDATE/DELETE target) are handled separately, keyed
// off `relation` directly.
const FROM_SHAPED_KEYS = new Set<string | null>([
  'fromClause',
  'usingClause',
  'larg',
  'rarg',
]);

function isFromShapedKey(key: string | null): boolean {
  return FROM_SHAPED_KEYS.has(key);
}

function buildFromTable(rv: RangeVarLike): FromTable {
  return {
    name: typeof rv.relname === 'string' ? rv.relname : '',
    ...(typeof rv.schemaname === 'string' ? { schema: rv.schemaname } : {}),
    ...(typeof rv.alias?.aliasname === 'string'
      ? { alias: rv.alias.aliasname }
      : {}),
  };
}
