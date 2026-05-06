// SQL-001 — Cartesian explosion risk.
//
// Severity:    block
// Confidence:  95 (range 90–95; see docs/rules/sql-001.md)
// Threat:      denial-of-service
//
// Pattern (must all be true to fire):
//   - The first statement we encounter is a SelectStmt
//   - Its top-level fromClause references >=2 distinct table-shaped
//     items (RangeVar / RangeSubselect)
//   - There is NO JoinExpr anywhere in the fromClause subtree
//     (an explicit JOIN — including `CROSS JOIN`, which Postgres
//     normalizes to JoinExpr+JOIN_INNER with no quals — counts as
//     intentional and suppresses)
//   - The whereClause does NOT contain a comparison whose two operands
//     are ColumnRef nodes attributed to two different tables in the
//     FROM set
//
// When all four conditions hold, the LLM (or human) almost certainly
// forgot the join predicate and the database is about to materialize
// the cartesian product of every table's row count.
//
// See docs/rules/sql-001.md for the full pattern explanation.

import { astWalk } from '../ast-walk.js';
import { extractFromTables, type FromTable } from '../extract-tables.js';
import type { Catch, Rule } from '../types.js';

export const SQL_001: Rule = (ast) => {
  // Step 1: walk to the FIRST SelectStmt at any depth. Multi-stmt
  // scripts trigger the rule on whichever SelectStmt comes first.
  // (UpdateStmt / DeleteStmt don't have a fromClause-with-multiple-
  // tables shape; nothing to detect there for SQL-001.)
  let stmt: Record<string, unknown> | null = null;
  astWalk(ast, (node) => {
    if (stmt) return 'stop';
    if (node && typeof node === 'object' && 'SelectStmt' in node) {
      stmt = (node as { SelectStmt: Record<string, unknown> }).SelectStmt;
      return 'stop';
    }
    return undefined;
  });
  if (!stmt) return null;
  const selectStmt: Record<string, unknown> = stmt;

  // Step 2: pull top-level tables. We synthesize a `{ fromClause: ... }`
  // wrapper so extractFromTables fires on the correct key. This keeps
  // the substrate semantics simple (RangeVars are only collected when
  // reached via FROM-shaped property names).
  const rawFromClause = selectStmt['fromClause'];
  if (!Array.isArray(rawFromClause) || rawFromClause.length === 0) {
    return null;
  }
  const tables = extractFromTables({ fromClause: rawFromClause });
  if (tables.length < 2) return null;

  // Step 3: any JoinExpr anywhere in fromClause means the user said
  // something explicit about table relationships — suppress. CROSS JOIN
  // is parsed as JoinExpr with jointype JOIN_INNER and no quals; that
  // counts as "intentional cartesian" and we honor it.
  let hasJoin = false;
  astWalk({ fromClause: rawFromClause }, (node) => {
    if (hasJoin) return 'stop';
    if (node && typeof node === 'object' && 'JoinExpr' in node) {
      hasJoin = true;
      return 'stop';
    }
    return undefined;
  });
  if (hasJoin) return null;

  // Step 4: heuristic WHERE-clause cross-table predicate check. If
  // any A_Expr has two ColumnRefs whose first-field qualifiers differ
  // and both qualifiers identify tables in our FROM set, treat the
  // WHERE as a join predicate and suppress.
  const whereClause = selectStmt['whereClause'];
  if (whereClause && hasCrossTablePredicate(whereClause, tables)) {
    return null;
  }

  // Step 5: fire.
  const tableNames = tables
    .map((t) => t.alias ?? (t.name === '' ? '<subquery>' : t.name))
    .join(', ');

  const result: Catch = {
    code: 'SQL-001',
    title: 'Cartesian explosion risk',
    severity: 'block',
    confidence: 95,
    detail:
      `${tables.length} tables (${tableNames}) appear in FROM without a ` +
      `JOIN clause or cross-table WHERE predicate. The result row count ` +
      `is the product of every table's row count, which grows ` +
      `multiplicatively and can exhaust memory on production-sized data.`,
    fix:
      'Add an explicit JOIN ... ON / USING clause that relates the ' +
      'tables, or add WHERE conditions that connect their rows. If the ' +
      'cross-product was intentional, use CROSS JOIN explicitly.',
    threatCategories: ['denial-of-service'],
  };
  return result;
};

/**
 * Heuristic: does the WHERE clause contain a binary comparison whose
 * two operands are ColumnRefs from two distinct tables in our FROM set?
 *
 * Implementation:
 *   - Build the set of "table identifiers" — alias if present, else
 *     the bare relname. (Postgres requires an alias when a table
 *     appears twice; bare names are unique-per-FROM otherwise.)
 *   - Walk every A_Expr in whereClause; for each, extract the
 *     first-field qualifier of the lexpr and rexpr ColumnRefs (if any)
 *   - If both qualifiers are present, both are in our identifier set,
 *     and they differ, that A_Expr counts as a cross-table predicate
 *
 * Known limitations (documented in docs/rules/sql-001.md):
 *   - Bare-column comparisons (`WHERE x = y` without table qualifiers)
 *     don't yield a qualifier and are treated as ambiguous → no
 *     cross-table predicate detected → catch fires
 *   - Predicates buried inside subqueries are walked but their
 *     qualifiers may not match any outer-FROM identifier → no
 *     cross-table predicate detected → catch fires
 *
 * Both behaviors are conservative for a `block`-severity catch:
 * false-positives force the LLM to add an explicit predicate or
 * CROSS JOIN; the cost of a false-positive is small.
 */
function hasCrossTablePredicate(
  whereClause: unknown,
  tables: readonly FromTable[],
): boolean {
  const identifiers = new Set<string>();
  for (const t of tables) {
    if (t.alias) identifiers.add(t.alias);
    else if (t.name) identifiers.add(t.name);
  }
  if (identifiers.size < 2) return false;

  let found = false;
  astWalk(whereClause, (node) => {
    if (found) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    if (!('A_Expr' in (node as Record<string, unknown>))) return undefined;

    const aexpr = (node as { A_Expr: Record<string, unknown> }).A_Expr;
    const lQual = getColumnQualifier(aexpr['lexpr']);
    const rQual = getColumnQualifier(aexpr['rexpr']);
    if (
      lQual !== null &&
      rQual !== null &&
      lQual !== rQual &&
      identifiers.has(lQual) &&
      identifiers.has(rQual)
    ) {
      found = true;
      return 'stop';
    }
    return undefined;
  });
  return found;
}

function getColumnQualifier(expr: unknown): string | null {
  if (!expr || typeof expr !== 'object') return null;
  if (!('ColumnRef' in (expr as Record<string, unknown>))) return null;
  const cr = (expr as { ColumnRef: { fields?: unknown[] } }).ColumnRef;
  const fields = cr.fields;
  if (!Array.isArray(fields) || fields.length < 2) return null;
  // First field is the table/alias qualifier; second is the column name.
  const f0 = fields[0];
  if (!f0 || typeof f0 !== 'object') return null;
  const sf = f0 as { String?: { sval?: string } };
  return typeof sf.String?.sval === 'string' ? sf.String.sval : null;
}
