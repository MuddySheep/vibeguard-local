// SQL-010 — Correlated subquery in SELECT projection.
//
// Severity:    warn
// Confidence:  75 (range 70-85; see docs/rules/sql-010.md)
// Threat:      integrity
//
// Pattern:
//   - First SelectStmt has a SubLink in its targetList — i.e., a
//     scalar subquery used in projection
//   - The subquery's whereClause references a column whose qualifier
//     matches an alias / relname in the OUTER SelectStmt's fromClause
//
// Why it's worth flagging: correlated subqueries in projection often
// produce N+1-shaped query plans (subquery executes once per outer
// row), which scales poorly compared to an explicit JOIN with
// aggregation. AI-generated SQL frequently reaches for the correlated
// shape because it's easier to "write English-like" than the JOIN
// rewrite.
//
// Suppressions verified:
//   - Uncorrelated subquery in SELECT — subquery has no outer
//     reference; doesn't fire
//   - Subquery in WHERE / HAVING — out of scope (legitimate
//     correlated WHERE / HAVING is common; sibling catch if there's
//     pull post-1.0)
//   - LATERAL — different AST shape (RangeFunction with isLateral),
//     not visited via the SubLink path

import { astWalk } from '../ast-walk.js';
import { extractFromTables, type FromTable } from '../extract-tables.js';
import type { Catch, Rule } from '../types.js';

interface SubLinkLike {
  readonly subLinkType?: string;
  readonly subselect?: unknown;
}

export const SQL_010: Rule = (ast) => {
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

  const targetList = stmt['targetList'];
  if (!Array.isArray(targetList) || targetList.length === 0) return null;

  // Build set of outer-FROM identifiers (alias preferred, else relname).
  const rawFromClause = stmt['fromClause'];
  if (!Array.isArray(rawFromClause) || rawFromClause.length === 0) {
    return null;
  }
  const outerTables = extractFromTables({ fromClause: rawFromClause });
  const outerIds = new Set<string>();
  for (const t of outerTables as readonly FromTable[]) {
    if (t.alias) outerIds.add(t.alias);
    else if (t.name) outerIds.add(t.name);
  }
  if (outerIds.size === 0) return null;

  // Walk each projection target for an EXPR_SUBLINK; for each, check
  // its subselect's whereClause for a ColumnRef qualified by an outer
  // alias.
  let hit: { correlatedAlias: string } | null = null;
  for (const target of targetList) {
    if (hit) break;
    if (!target || typeof target !== 'object') continue;
    if (!('ResTarget' in (target as Record<string, unknown>))) continue;
    const rt = (target as { ResTarget: { val?: unknown } }).ResTarget;
    visitForCorrelation(rt.val, outerIds, (alias) => {
      hit = { correlatedAlias: alias };
    });
  }

  if (!hit) return null;
  const h: { correlatedAlias: string } = hit;

  const result: Catch = {
    code: 'SQL-010',
    title: 'Correlated subquery in SELECT projection',
    severity: 'warn',
    confidence: 75,
    detail:
      `A scalar subquery in the SELECT projection references the ` +
      `outer table alias \`${h.correlatedAlias}\`. Correlated ` +
      `subqueries in projection often produce N+1 query plans (the ` +
      `subquery executes once per outer row), which scales poorly ` +
      `compared to an explicit JOIN + aggregation rewrite.`,
    fix:
      'Rewrite as a JOIN with GROUP BY (or use a LATERAL join) so the ' +
      'database can plan the operation as a single scan rather than ' +
      'per-row subquery execution. The result of the rewrite is ' +
      'usually faster and equally readable.',
    threatCategories: ['integrity'],
  };
  return result;
};

// Recursively walk a projection expression looking for EXPR_SUBLINK
// nodes. For each, walk its subselect.SelectStmt.whereClause looking
// for any ColumnRef whose first-field qualifier matches an outer
// alias. Calls `onHit(alias)` on the first match.
function visitForCorrelation(
  expr: unknown,
  outerIds: ReadonlySet<string>,
  onHit: (alias: string) => void,
): void {
  let stopped = false;
  astWalk(expr, (node) => {
    if (stopped) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    if (!('SubLink' in obj)) return undefined;
    const sl = obj['SubLink'] as SubLinkLike;
    if (sl.subLinkType !== 'EXPR_SUBLINK') return undefined;

    const subselect = sl.subselect;
    if (!subselect || typeof subselect !== 'object') return undefined;
    const inner = (subselect as { SelectStmt?: Record<string, unknown> })
      .SelectStmt;
    if (!inner) return undefined;

    const whereClause = inner['whereClause'];
    if (!whereClause) return undefined;

    const correlated = findOuterReference(whereClause, outerIds);
    if (correlated !== null) {
      stopped = true;
      onHit(correlated);
      return 'stop';
    }
    // Don't descend into this SubLink's subselect via the outer walker.
    // Inner correlated-subqueries-of-correlated-subqueries are out of
    // scope for v1; they'd be a separate fire on the inner-most outer.
    return 'skip';
  });
}

function findOuterReference(
  whereClause: unknown,
  outerIds: ReadonlySet<string>,
): string | null {
  let found: string | null = null;
  astWalk(whereClause, (node) => {
    if (found !== null) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    if (!('ColumnRef' in (node as Record<string, unknown>))) return undefined;
    const cr = (node as { ColumnRef: { fields?: readonly unknown[] } })
      .ColumnRef;
    const fields = cr.fields;
    if (!Array.isArray(fields) || fields.length < 2) return undefined;
    // First field is the qualifier (alias or relname).
    const qualifier = readStringField(fields[0]);
    if (qualifier !== null && outerIds.has(qualifier)) {
      found = qualifier;
      return 'stop';
    }
    return undefined;
  });
  return found;
}

function readStringField(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as { String?: { sval?: string } };
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}
