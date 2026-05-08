// SQL-007 — NOT IN with potentially-nullable subquery.
//
// Severity:    warn
// Confidence:  80 (range 75-85; see docs/rules/sql-007.md)
// Threat:      corruption
//
// Pattern:
//   - A `WHERE x NOT IN (SELECT y FROM ...)` shape — encoded by
//     libpg-query as `BoolExpr{boolop: NOT_EXPR, args: [SubLink{
//     subLinkType: ANY_SUBLINK, testexpr, subselect}]}`
//   - The subquery's projection is NOT explicitly guarded against
//     NULL via:
//       - `WHERE projected_col IS NOT NULL` predicate, OR
//       - The projection itself is wrapped in `coalesce` / `nullif`
//         / `ifnull`
//
// Why it's a bug: in three-valued logic, `x NOT IN (..., NULL, ...)`
// always evaluates to UNKNOWN (treated as false), so the WHERE
// silently filters everything out. A frequently-cited footgun.
//
// Suppressions verified:
//   - `NOT IN (1, 2, 3)` (literal list) — different AST shape
//     (A_Expr with AEXPR_IN), doesn't enter this path
//   - `NOT IN (SELECT col FROM t WHERE col IS NOT NULL)` — guarded
//   - `NOT IN (SELECT coalesce(col, 0) FROM t)` — projection wraps
//     the column in coalesce, never NULL
//   - `NOT EXISTS (SELECT 1 FROM ...)` — different shape entirely
//
// Known limitations (documented in docs/rules/sql-007.md):
//   - We don't detect implicit NOT-NULL guards via predicates like
//     `col > 0` or schema-NOT-NULL constraints; these may yield
//     false positives
//   - We don't detect composite NOT IN forms `(a, b) NOT IN (...)`
//     beyond the basic shape

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface SubLinkLike {
  readonly subLinkType?: string;
  readonly testexpr?: unknown;
  readonly subselect?: unknown;
}

const NULL_GUARD_FUNCS = new Set<string>([
  'coalesce',
  'nullif',
  'ifnull',
  'isnull',
]);

export const SQL_007: Rule = (ast) => {
  let hit: { columnName: string | null } | null = null;

  astWalk(ast, (node) => {
    if (hit) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    if (!('BoolExpr' in obj)) return undefined;

    const be = obj['BoolExpr'] as { boolop?: string; args?: readonly unknown[] };
    if (be.boolop !== 'NOT_EXPR') return undefined;
    if (!Array.isArray(be.args)) return undefined;

    for (const arg of be.args) {
      if (!arg || typeof arg !== 'object') continue;
      if (!('SubLink' in (arg as Record<string, unknown>))) continue;
      const sl = (arg as { SubLink: SubLinkLike }).SubLink;
      if (sl.subLinkType !== 'ANY_SUBLINK') continue;

      // It's a NOT (x ANY-SUBLINK ...) — i.e., NOT IN subquery.
      const subselect = sl.subselect;
      if (!subselect || typeof subselect !== 'object') continue;
      const inner = (subselect as { SelectStmt?: Record<string, unknown> })
        .SelectStmt;
      if (!inner) continue;

      // Get the FIRST projected column name. Composite NOT IN with
      // multiple projection columns is out-of-scope-v1 — fire on the
      // first column's nullability concern.
      const targetList = inner['targetList'];
      if (!Array.isArray(targetList) || targetList.length === 0) continue;
      const firstTarget = targetList[0];
      const proj = readProjectionExpr(firstTarget);
      if (!proj) continue;

      // If projection itself is a null-guarding function (coalesce/etc.),
      // the result is never NULL — suppress.
      if (proj.kind === 'guarded-by-function') continue;

      // Otherwise the projection is a bare column reference. Look for
      // a matching IS NOT NULL guard in subselect.whereClause.
      const colName = proj.column;
      const whereClause = inner['whereClause'];
      if (whereClause && hasIsNotNullGuard(whereClause, colName)) {
        continue;
      }

      hit = { columnName: colName };
      return 'stop';
    }
    return undefined;
  });

  if (!hit) return null;
  const h: { columnName: string | null } = hit;

  const colDisplay = h.columnName ?? '<column>';
  const result: Catch = {
    code: 'SQL-007',
    title: 'NOT IN with potentially-nullable subquery',
    severity: 'warn',
    confidence: 80,
    detail:
      `\`NOT IN (SELECT ${colDisplay} FROM ...)\` does not guard the ` +
      'subquery projection against NULL. If any returned row has NULL ' +
      "in that column, SQL's three-valued logic makes the entire NOT " +
      'IN evaluate to UNKNOWN — and the outer WHERE silently filters ' +
      'every row out, even rows that are clearly not in the banned ' +
      'set.',
    fix:
      `Add an \`IS NOT NULL\` predicate inside the subquery (\`WHERE ` +
      `${colDisplay} IS NOT NULL\`), or wrap the projection in ` +
      `\`coalesce(${colDisplay}, <sentinel>)\`. Even better: rewrite ` +
      `as \`NOT EXISTS (SELECT 1 FROM ... WHERE outer.x = inner.${colDisplay})\` ` +
      `which is NULL-safe by construction.`,
    threatCategories: ['corruption'],
  };
  return result;
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

interface ProjectionInfo {
  readonly kind: 'guarded-by-function' | 'column';
  readonly column: string | null;
}

function readProjectionExpr(target: unknown): ProjectionInfo | null {
  if (!target || typeof target !== 'object') return null;
  if (!('ResTarget' in (target as Record<string, unknown>))) return null;
  const rt = (target as { ResTarget: { val?: unknown } }).ResTarget;
  const val = rt.val;
  if (!val || typeof val !== 'object') return null;
  const obj = val as Record<string, unknown>;

  // libpg-query represents `coalesce(...)` as `CoalesceExpr` and
  // `nullif(...)` as `A_Expr` with `kind = AEXPR_NULLIF`. Both
  // signal NULL-handling intent and suppress the catch.
  if ('CoalesceExpr' in obj) {
    return { kind: 'guarded-by-function', column: null };
  }
  if ('A_Expr' in obj) {
    const ae = obj['A_Expr'] as { kind?: string };
    if (ae.kind === 'AEXPR_NULLIF') {
      return { kind: 'guarded-by-function', column: null };
    }
  }

  if ('FuncCall' in obj) {
    const fc = obj['FuncCall'] as { funcname?: readonly unknown[] };
    const fname = readLastFuncName(fc.funcname);
    // Some Postgres extensions / dialect ports do expose these as
    // function calls — keep the catalog match as a backstop.
    if (fname && NULL_GUARD_FUNCS.has(fname)) {
      return { kind: 'guarded-by-function', column: null };
    }
    // Other function calls — treat as a column-shaped projection
    // (we can't easily say whether the function returns NULL).
    return { kind: 'column', column: null };
  }

  if ('ColumnRef' in obj) {
    const cr = obj['ColumnRef'] as { fields?: readonly unknown[] };
    return { kind: 'column', column: readColumnLastField(cr.fields) };
  }

  // Other projection shapes — treat as a column whose name we don't
  // know. The IS-NOT-NULL guard match by name will fail conservatively.
  return { kind: 'column', column: null };
}

function readLastFuncName(funcname: readonly unknown[] | undefined): string | null {
  if (!Array.isArray(funcname) || funcname.length === 0) return null;
  const last = funcname[funcname.length - 1];
  if (!last || typeof last !== 'object') return null;
  const f = last as { String?: { sval?: string } };
  return typeof f.String?.sval === 'string'
    ? f.String.sval.toLowerCase()
    : null;
}

function readColumnLastField(fields: readonly unknown[] | undefined): string | null {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const last = fields[fields.length - 1];
  if (!last || typeof last !== 'object') return null;
  const f = last as { String?: { sval?: string }; A_Star?: unknown };
  if (f.A_Star) return null;
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}

function hasIsNotNullGuard(whereClause: unknown, column: string | null): boolean {
  if (!whereClause) return false;
  let found = false;
  astWalk(whereClause, (node) => {
    if (found) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    if (!('NullTest' in (node as Record<string, unknown>))) return undefined;
    const nt = (node as {
      NullTest: { nulltesttype?: string; arg?: unknown };
    }).NullTest;
    if (nt.nulltesttype !== 'IS_NOT_NULL') return undefined;
    // If we don't know the column name (anonymous projection), accept
    // any IS NOT NULL test as "good enough" — the user clearly tried
    // to handle nullability.
    if (column === null) {
      found = true;
      return 'stop';
    }
    // Match arg ColumnRef against expected column name.
    const arg = nt.arg;
    if (arg && typeof arg === 'object' && 'ColumnRef' in (arg as Record<string, unknown>)) {
      const cr = (arg as { ColumnRef: { fields?: readonly unknown[] } })
        .ColumnRef;
      const argName = readColumnLastField(cr.fields);
      if (argName === column) {
        found = true;
        return 'stop';
      }
    }
    return undefined;
  });
  return found;
}
