// SQL-001 — Cartesian explosion risk.
//
// Severity:    block
// Confidence:  95 (range 90–95; see docs/rules/sql-001.md)
// Threat:      denial-of-service
//
// Pattern (must all be true to fire):
//   - The first statement we encounter is a SelectStmt, UpdateStmt,
//     or DeleteStmt
//   - Its effective from-list references >=2 distinct table-shaped
//     items (RangeVar / RangeSubselect). For UPDATE this is the
//     target relation + `fromClause`; for DELETE it's the target
//     relation + `usingClause`.
//   - There is NO JoinExpr anywhere in the from-list subtree
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
// V1.5 extension: UPDATE … FROM and DELETE … USING used to slip
// through because the rule only walked SelectStmt. The cartesian
// shape is identical, so the rule now covers all three statement
// kinds via the shared `findFromBearingStmt` helper.
//
// See docs/rules/sql-001.md for the full pattern explanation.

import { astWalk } from '../ast-walk.js';
import { extractFromTables, type FromTable } from '../extract-tables.js';
import { maskStringLiterals } from '../fix-utils.js';
import type { Catch, Fixer, Rule } from '../types.js';
import { findFromBearingStmt } from './find-stmt.js';

export const SQL_001: Rule = (ast) => {
  // Step 1: find the first SelectStmt / UpdateStmt / DeleteStmt at
  // any depth. Multi-stmt scripts trigger on whichever comes first.
  // For UPDATE/DELETE, the effective from-list includes the target
  // relation alongside the fromClause / usingClause entries.
  const shape = findFromBearingStmt(ast);
  if (!shape) return null;

  // Step 2: pull top-level tables. We synthesize a `{ fromClause: ... }`
  // wrapper so extractFromTables fires on the correct key. This keeps
  // the substrate semantics simple (RangeVars are only collected when
  // reached via FROM-shaped property names).
  const rawFromClause = shape.fromClause;
  if (rawFromClause.length === 0) return null;
  const tables = extractFromTables({ fromClause: rawFromClause });
  if (tables.length < 2) return null;

  // Step 3: any JoinExpr anywhere in the from-list means the user said
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
  const whereClause = shape.whereClause;
  if (whereClause && hasCrossTablePredicate(whereClause, tables)) {
    return null;
  }

  // Step 5: fire. Detail prose adapts to the statement kind so the
  // catch reads naturally for UPDATE-FROM and DELETE-USING.
  const tableNames = tables
    .map((t) => t.alias ?? (t.name === '' ? '<subquery>' : t.name))
    .join(', ');

  const detail = buildDetail(shape, tables.length, tableNames);
  const fix = buildFix(shape);

  const result: Catch = {
    code: 'SQL-001',
    title: 'Cartesian explosion risk',
    severity: 'block',
    confidence: 95,
    detail,
    fix,
    threatCategories: ['denial-of-service'],
  };
  return result;
};

function buildDetail(
  shape: { kind: 'SelectStmt' | 'UpdateStmt' | 'DeleteStmt'; targetRelname: string | null },
  count: number,
  tableNames: string,
): string {
  if (shape.kind === 'SelectStmt') {
    return (
      `${count} tables (${tableNames}) appear in FROM without a ` +
      `JOIN clause or cross-table WHERE predicate. The result row count ` +
      `is the product of every table's row count, which grows ` +
      `multiplicatively and can exhaust memory on production-sized data.`
    );
  }
  const target = shape.targetRelname ?? '<table>';
  const cluster = shape.kind === 'UpdateStmt' ? 'FROM' : 'USING';
  const verb = shape.kind === 'UpdateStmt' ? 'UPDATE' : 'DELETE';
  return (
    `${verb} on \`${target}\` plus its ${cluster} clause references ` +
    `${count} tables (${tableNames}) without a JOIN clause or cross-` +
    `table WHERE predicate. The planner builds the cartesian product ` +
    `of every relation before applying the WHERE filter — N×M rows ` +
    `materialize for the write, which can exhaust memory and serialize ` +
    `the lock on production-sized data.`
  );
}

function buildFix(shape: {
  kind: 'SelectStmt' | 'UpdateStmt' | 'DeleteStmt';
}): string {
  if (shape.kind === 'SelectStmt') {
    return (
      'Add an explicit JOIN ... ON / USING clause that relates the ' +
      'tables, or add WHERE conditions that connect their rows. If the ' +
      'cross-product was intentional, use CROSS JOIN explicitly.'
    );
  }
  const cluster = shape.kind === 'UpdateStmt' ? 'FROM' : 'USING';
  return (
    `Add a WHERE predicate that connects the target relation to the ` +
    `${cluster} relation (e.g. \`t1.parent_id = t2.id\`). If the secondary ` +
    `relation is unused, remove it from the statement entirely. If the ` +
    `cartesian was deliberate, the statement is almost certainly wrong — ` +
    `review with an operator before running.`
  );
}

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

// ---------------------------------------------------------------------
// SQL-001 autofix
// ---------------------------------------------------------------------

/**
 * Placeholder fix for SQL-001:
 *
 *   FROM a, b      →  FROM a JOIN b ON TRUE /* TODO(vibeguard SQL-001): replace TRUE with a real predicate * /
 *
 * For 3+ comma-separated tables the fixer fires once per call and
 * the runner iterates: subsequent commas convert in subsequent passes.
 *
 * We use `ON TRUE` (functionally equivalent to a CROSS JOIN) plus an
 * inline TODO comment because:
 *
 *   - Postgres requires a boolean expression after `ON`. A
 *     comment-only `ON` clause doesn't parse, which would cause the
 *     fix-runner's parse-verify step to reject the fix.
 *
 *   - The semantics are unchanged from the implicit cartesian — both
 *     `FROM a, b` and `FROM a JOIN b ON TRUE` produce the cross
 *     product. The fix doesn't claim to make the query safe; it
 *     converts an implicit cartesian into a marked, explicit one
 *     that downstream tooling and human reviewers can spot at a
 *     glance.
 *
 *   - The TODO comment names the rule, so an agent retry loop reading
 *     the diff has a structured signal to look for and act on.
 *
 * The trade-off: SQL-001 stops firing on the fixed query (because a
 * JoinExpr is now explicit), so the catch goes away even though the
 * cartesian is still there. This is honest fail-soft autofix
 * behavior; the docs page documents the placeholder semantics so
 * customers using --fix know what they're getting.
 *
 * Fail-soft: returns null on FROM clauses we can't parse with our
 * targeted regex (subquery FROM, complex aliases, embedded comments).
 * The catch surfaces unchanged in those cases — better than a
 * brittle source rewrite.
 */
export const SQL_001_FIX: Fixer = {
  fix(ast: unknown, sql: string): string | null {
    if (SQL_001(ast) === null) return null;

    // Find the first FROM ... , ... pattern in the masked source.
    // Limited to the simple cases — bare relname, optional schema
    // qualifier, optional alias (with or without AS keyword), then
    // a comma, then the same shape again. Subquery FROMs and
    // complex parenthesized expressions fall through to null.
    const masked = maskStringLiterals(sql);

    // Negative lookahead so the optional-alias capture doesn't swallow
    // SQL keywords that legitimately follow the table reference.
    // Without this, `FROM a, b WHERE x` matches the alias as `b WHERE`,
    // and the rewrite produces unparseable SQL.
    const NOT_KEYWORD =
      '(?!(?:WHERE|ORDER|GROUP|LIMIT|OFFSET|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|NATURAL|USING|ON|HAVING|UNION|INTERSECT|EXCEPT|RETURNING|FETCH|FOR|WINDOW)\\b)';

    // Anchor on the keyword `FROM`; capture the first two table
    // references separated by a comma. Each table is name (with
    // optional schema) + optional alias that isn't a SQL keyword.
    const tableShape =
      `\\w+(?:\\.\\w+)?(?:\\s+(?:AS\\s+)?${NOT_KEYWORD}\\w+)?`;
    const fromTablePattern = `(${tableShape})\\s*,\\s*(${tableShape})`;
    const re = new RegExp(`\\bFROM\\s+${fromTablePattern}`, 'i');
    const m = masked.match(re);
    if (!m || m.index === undefined) return null;

    // m[0] starts at "FROM". The captured groups are the two tables.
    // Reconstruct from the original source so we preserve casing/whitespace.
    const fromKeyword = sql.slice(m.index, m.index + 'FROM'.length);
    const tail = sql.slice(m.index + m[0].length);
    const head = sql.slice(0, m.index);
    const t1 = m[1];
    const t2 = m[2];
    if (!t1 || !t2) return null;

    const replacement =
      `${fromKeyword} ${t1} JOIN ${t2} ` +
      `ON TRUE /* TODO(vibeguard SQL-001): replace TRUE with a real predicate */`;
    return head + replacement + tail;
  },
};
