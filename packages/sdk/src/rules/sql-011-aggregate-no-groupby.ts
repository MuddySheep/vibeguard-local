// SQL-011 — Aggregate function with non-aggregated columns and no GROUP BY.
//
// Severity:    warn
// Confidence:  90 (range 85-95; see docs/rules/sql-011.md)
// Threat:      corruption
//
// Pattern:
//   - First SelectStmt has no GROUP BY (groupClause empty / absent)
//   - targetList contains BOTH:
//     * at least one aggregate FuncCall (count, sum, avg, etc.)
//       that is NOT a window function (no `over` clause)
//     * at least one "naked" ColumnRef — a column reference outside
//       any aggregate or window function call
//
// Postgres rejects this query at runtime with "column must appear in
// GROUP BY clause or be used in an aggregate function." The catch
// surfaces it pre-execution to save the round-trip and feed the LLM
// structured feedback.
//
// Aggregate detection: we use a vetted inline list of public Postgres
// aggregate functions. Custom CREATE AGGREGATE functions don't appear
// here and won't trigger the rule (false-negative; documented).
//
// Window functions: a FuncCall with `over` set is a window function,
// not an aggregate, even when its name matches an aggregate (e.g.
// `count(*) OVER ()`). The rule explicitly skips window FuncCalls in
// the aggregate detection step.

import { astWalk } from '../ast-walk.js';
import { maskStringLiterals } from '../fix-utils.js';
import type { Catch, Fixer, Rule } from '../types.js';

// Public Postgres aggregate functions. Source: PostgreSQL docs on
// aggregate functions. Built-in aggregates only — user-defined
// aggregates aren't statically detectable.
const POSTGRES_AGGREGATES = new Set<string>([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'string_agg',
  'array_agg',
  'json_agg',
  'jsonb_agg',
  'json_object_agg',
  'jsonb_object_agg',
  'bool_and',
  'bool_or',
  'every',
  'bit_and',
  'bit_or',
  'xmlagg',
  'corr',
  'covar_pop',
  'covar_samp',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'mode',
  'percentile_cont',
  'percentile_disc',
]);

interface FuncCallLike {
  readonly funcname?: readonly unknown[];
  readonly args?: readonly unknown[];
  readonly over?: unknown;
  readonly agg_filter?: unknown;
  readonly agg_order?: readonly unknown[];
  readonly agg_star?: boolean;
}

export const SQL_011: Rule = (ast) => {
  // Find first SelectStmt.
  let selectStmt: Record<string, unknown> | null = null;
  astWalk(ast, (node) => {
    if (selectStmt) return 'stop';
    if (node && typeof node === 'object' && 'SelectStmt' in node) {
      selectStmt = (node as { SelectStmt: Record<string, unknown> })
        .SelectStmt;
      return 'stop';
    }
    return undefined;
  });
  if (!selectStmt) return null;
  const stmt: Record<string, unknown> = selectStmt;

  // Suppress when GROUP BY is present.
  const groupClause = stmt['groupClause'];
  if (Array.isArray(groupClause) && groupClause.length > 0) return null;

  const targetList = stmt['targetList'];
  if (!Array.isArray(targetList) || targetList.length === 0) return null;

  let hasAggregate = false;
  let hasNakedColumn = false;
  let aggregateName: string | null = null;
  let nakedColumnName: string | null = null;

  // Custom recursive walker that tracks "inside an aggregate / window
  // function" depth — astWalk doesn't propagate that state, so we
  // implement a focused descent here.
  const visit = (node: unknown, insideAggOrWindow: boolean): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    // STOP at subquery boundaries.
    //
    // GROUP BY / aggregate validity is a per-query-level rule. A
    // scalar / EXISTS / IN subquery in the outer projection has its
    // own SELECT scope; whatever aggregates and column refs live
    // inside don't affect whether the OUTER query needs a GROUP BY.
    //
    // Without this stop, an outer query like:
    //   SELECT u.id, (SELECT count(*) FROM orders ...) FROM users u
    // would falsely "borrow" the inner count(*) as the outer's
    // aggregate, making u.id look like a naked-with-aggregate
    // violation. Postgres doesn't reject this at runtime, so we
    // shouldn't either. (Caught while reviewing the V1.5 playground
    // — the SQL-010 sample triggered SQL-011 spuriously.)
    if ('SubLink' in obj) return;

    if ('ColumnRef' in obj) {
      if (!insideAggOrWindow) {
        hasNakedColumn = true;
        if (nakedColumnName === null) {
          nakedColumnName = readColumnName(obj['ColumnRef']);
        }
      }
      return;
    }

    if ('FuncCall' in obj) {
      const fc = obj['FuncCall'] as FuncCallLike;
      const isWindow = fc.over !== undefined && fc.over !== null;
      const fname = readFuncName(fc.funcname);
      const isAgg =
        !isWindow && fname !== null && POSTGRES_AGGREGATES.has(fname);

      if (isAgg) {
        hasAggregate = true;
        if (aggregateName === null && fname !== null) aggregateName = fname;
      }

      const newInside = insideAggOrWindow || isAgg || isWindow;

      // Descend into FuncCall sub-expressions with the new flag.
      if (Array.isArray(fc.args)) {
        for (const arg of fc.args) visit(arg, newInside);
      }
      if (fc.over !== undefined) visit(fc.over, newInside);
      if (fc.agg_filter !== undefined) visit(fc.agg_filter, newInside);
      if (Array.isArray(fc.agg_order)) {
        for (const ord of fc.agg_order) visit(ord, newInside);
      }
      return;
    }

    // Generic descent into children.
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      if (Array.isArray(child)) {
        for (const item of child) visit(item, insideAggOrWindow);
      } else if (child && typeof child === 'object') {
        visit(child, insideAggOrWindow);
      }
    }
  };

  for (const target of targetList) {
    if (!target || typeof target !== 'object') continue;
    if (!('ResTarget' in (target as Record<string, unknown>))) continue;
    const rt = (target as { ResTarget: { val?: unknown } }).ResTarget;
    visit(rt.val, false);
  }

  if (!hasAggregate || !hasNakedColumn) return null;

  const result: Catch = {
    code: 'SQL-011',
    title: 'Aggregate with non-aggregated column and no GROUP BY',
    severity: 'warn',
    confidence: 90,
    detail:
      `The SELECT mixes an aggregate \`${aggregateName ?? '<aggregate>'}()\` ` +
      `with a non-aggregated column \`${nakedColumnName ?? '<column>'}\`, ` +
      `but there is no GROUP BY clause. Postgres rejects this query at ` +
      `runtime with "column must appear in the GROUP BY clause or be ` +
      `used in an aggregate function".`,
    fix:
      'Either add a GROUP BY clause naming the non-aggregated columns, ' +
      'wrap the bare column reference in an aggregate (e.g. ' +
      '`max(name)`), or drop the bare column from the projection if it ' +
      "isn't actually needed.",
    threatCategories: ['corruption'],
  };
  return result;
};

function readFuncName(funcname: readonly unknown[] | undefined): string | null {
  if (!Array.isArray(funcname) || funcname.length === 0) return null;
  // Last name component is the function name (preceded by optional
  // schema components like `pg_catalog`).
  const last = funcname[funcname.length - 1];
  if (!last || typeof last !== 'object') return null;
  const f = last as { String?: { sval?: string } };
  return typeof f.String?.sval === 'string'
    ? f.String.sval.toLowerCase()
    : null;
}

function readColumnName(columnRef: unknown): string | null {
  if (!columnRef || typeof columnRef !== 'object') return null;
  const cr = columnRef as { fields?: unknown[] };
  if (!Array.isArray(cr.fields) || cr.fields.length === 0) return null;
  const last = cr.fields[cr.fields.length - 1];
  if (!last || typeof last !== 'object') return null;
  const f = last as { String?: { sval?: string }; A_Star?: unknown };
  if (f.A_Star) return '*';
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}

/**
 * Read a ColumnRef's full qualified path (`t.name` or just `name`).
 * Returns null on shapes we don't handle (A_Star projections, nested
 * indirection, function-call qualifiers).
 */
function readQualifiedColumnName(columnRef: unknown): string | null {
  if (!columnRef || typeof columnRef !== 'object') return null;
  const cr = columnRef as { fields?: unknown[] };
  if (!Array.isArray(cr.fields) || cr.fields.length === 0) return null;
  const parts: string[] = [];
  for (const field of cr.fields) {
    if (!field || typeof field !== 'object') return null;
    const f = field as { String?: { sval?: string }; A_Star?: unknown };
    if (f.A_Star) return null; // can't GROUP BY a star
    if (typeof f.String?.sval !== 'string') return null;
    parts.push(f.String.sval);
  }
  return parts.length > 0 ? parts.join('.') : null;
}

// ---------------------------------------------------------------------
// SQL-011 autofix
// ---------------------------------------------------------------------

/**
 * Add the missing GROUP BY clause naming the first naked column in
 * the SELECT projection.
 *
 *   SELECT t.name, COUNT(*) FROM t
 *     →  SELECT t.name, COUNT(*) FROM t GROUP BY t.name
 *
 *   SELECT name, COUNT(*) FROM t WHERE active
 *     →  SELECT name, COUNT(*) FROM t WHERE active GROUP BY name
 *
 *   SELECT name, COUNT(*) FROM t ORDER BY 2 DESC
 *     →  SELECT name, COUNT(*) FROM t GROUP BY name ORDER BY 2 DESC
 *
 * Insertion point: before the first occurrence of
 *   HAVING / ORDER BY / LIMIT / OFFSET / FETCH / FOR UPDATE
 * If none of those keywords are present, append at end-of-statement
 * (just before any trailing semicolon).
 *
 * Fail-soft: returns null when the bare-column shape isn't a simple
 * qualified identifier (e.g. computed expressions, A_Star, or paths
 * with array indirection). The catch keeps surfacing unchanged.
 */
export const SQL_011_FIX: Fixer = {
  fix(ast: unknown, sql: string): string | null {
    if (SQL_011(ast) === null) return null;

    // Re-walk to extract the FIRST naked column's qualified name.
    let qualifiedColumn: string | null = null;
    const findVisit = (node: unknown, insideAggOrWindow: boolean): void => {
      if (qualifiedColumn !== null) return;
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;

      if ('ColumnRef' in obj) {
        if (!insideAggOrWindow) {
          qualifiedColumn = readQualifiedColumnName(obj['ColumnRef']);
        }
        return;
      }

      if ('FuncCall' in obj) {
        const fc = obj['FuncCall'] as FuncCallLike;
        const isWindow = fc.over !== undefined && fc.over !== null;
        const fname = readFuncName(fc.funcname);
        const isAgg =
          !isWindow && fname !== null && POSTGRES_AGGREGATES.has(fname);
        const newInside = insideAggOrWindow || isAgg || isWindow;
        if (Array.isArray(fc.args)) for (const a of fc.args) findVisit(a, newInside);
        if (fc.over !== undefined) findVisit(fc.over, newInside);
        if (fc.agg_filter !== undefined) findVisit(fc.agg_filter, newInside);
        if (Array.isArray(fc.agg_order))
          for (const o of fc.agg_order) findVisit(o, newInside);
        return;
      }

      for (const key of Object.keys(obj)) {
        const child = obj[key];
        if (Array.isArray(child)) {
          for (const item of child) findVisit(item, insideAggOrWindow);
        } else if (child && typeof child === 'object') {
          findVisit(child, insideAggOrWindow);
        }
      }
    };

    // Locate first SelectStmt's targetList again — same approach as
    // the rule itself.
    let targetList: unknown[] | null = null;
    astWalk(ast, (node) => {
      if (targetList) return 'stop';
      if (node && typeof node === 'object' && 'SelectStmt' in node) {
        const ss = (node as { SelectStmt: Record<string, unknown> }).SelectStmt;
        const tl = ss['targetList'];
        if (Array.isArray(tl)) targetList = tl;
        return 'stop';
      }
      return undefined;
    });
    if (!targetList) return null;
    const list: unknown[] = targetList;

    for (const target of list) {
      if (!target || typeof target !== 'object') continue;
      if (!('ResTarget' in (target as Record<string, unknown>))) continue;
      const rt = (target as { ResTarget: { val?: unknown } }).ResTarget;
      findVisit(rt.val, false);
      if (qualifiedColumn !== null) break;
    }

    if (qualifiedColumn === null) return null;

    // Decide insertion point in the source.
    const masked = maskStringLiterals(sql);
    const trailingClauseRe = /\b(HAVING|ORDER\s+BY|LIMIT|OFFSET|FETCH|FOR\s+UPDATE|FOR\s+NO\s+KEY\s+UPDATE|FOR\s+SHARE|FOR\s+KEY\s+SHARE)\b/i;
    const trailing = masked.match(trailingClauseRe);
    const groupByClause = ` GROUP BY ${qualifiedColumn} `;

    if (trailing && trailing.index !== undefined) {
      const pos = trailing.index;
      // Trim any extra space introduced just before the trailing clause.
      const before = sql.slice(0, pos).replace(/\s+$/, '');
      const after = sql.slice(pos);
      return `${before}${groupByClause}${after}`;
    }

    // No trailing clause — append before any final semicolon / whitespace.
    const trailingSemi = /;\s*$/.exec(sql);
    if (trailingSemi) {
      const cut = trailingSemi.index;
      const before = sql.slice(0, cut).replace(/\s+$/, '');
      return `${before} GROUP BY ${qualifiedColumn}${sql.slice(cut)}`;
    }
    const trimmed = sql.replace(/\s+$/, '');
    return `${trimmed} GROUP BY ${qualifiedColumn}\n`;
  },
};
