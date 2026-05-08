// SQL-002 — Self-join footgun.
//
// Severity:    warn
// Confidence:  75 (range 70-85; see docs/rules/sql-002.md)
// Threat:      integrity
//
// Pattern (must all hold to fire):
//   - The first SelectStmt / UpdateStmt / DeleteStmt's effective
//     from-list references the same base relation (relname) two or
//     more times — i.e. a self-join. For UPDATE this includes the
//     target relation + `fromClause`; for DELETE the target +
//     `usingClause`.
//   - There is no predicate (ON-clause OR WHERE-clause comparison)
//     that connects two distinct aliases of that relation via two
//     DIFFERENT columns
//
// What counts as a "good" predicate (suppresses the catch):
//   - `u1.parent_id = u2.id` — different aliases, different columns
//
// What does NOT suppress (catch fires):
//   - No predicate at all
//   - `u1.id = u1.id` — tautology (same alias on both sides)
//   - `u1.id = u2.id` — same-column equality across aliases (rare
//     to actually want this; usually a sign the LLM forgot to vary
//     the column reference)
//
// CTE shadowing: a CTE name reused as a base-table reference produces
// the same AST shape as a base-table self-join. The catch fires
// regardless. Documented in docs/rules/sql-002.md.
//
// V1.5 extension: UPDATE … FROM same_table and DELETE … USING
// same_table used to slip through because the rule only walked
// SelectStmt. Same self-join semantics, same risk; the rule now
// covers all three statement kinds via `findFromBearingStmt`.

import { astWalk } from '../ast-walk.js';
import { extractFromTables, type FromTable } from '../extract-tables.js';
import type { Catch, Rule } from '../types.js';
import { findFromBearingStmt } from './find-stmt.js';

interface ColumnInfo {
  readonly alias: string | null;
  readonly column: string | null;
}

type Classification =
  | 'unrelated'
  | 'tautology'
  | 'same-column'
  | 'good';

export const SQL_002: Rule = (ast) => {
  // Step 1 — find first SelectStmt / UpdateStmt / DeleteStmt.
  const shape = findFromBearingStmt(ast);
  if (!shape) return null;

  const rawFromClause = shape.fromClause;
  if (rawFromClause.length === 0) return null;

  // Step 2 — extract tables (top-level FROM only) and group by relname.
  const tables = extractFromTables({ fromClause: rawFromClause });
  const groups = new Map<string, FromTable[]>();
  for (const t of tables) {
    if (!t.name || t.isSubquery) continue;
    const list = groups.get(t.name);
    if (list) list.push(t);
    else groups.set(t.name, [t]);
  }

  // Step 3 — for each multi-group, classify predicates.
  for (const [relname, group] of groups) {
    if (group.length < 2) continue;
    const identifiers = new Set<string>();
    for (const t of group) {
      identifiers.add(t.alias ?? t.name);
    }

    const predicates = collectComparisons(
      rawFromClause,
      shape.whereClause,
    );
    let foundGood = false;
    let foundAnyRelevant = false;
    for (const pred of predicates) {
      const classification = classifyComparison(pred, identifiers);
      if (classification === 'unrelated') continue;
      foundAnyRelevant = true;
      if (classification === 'good') {
        foundGood = true;
        break;
      }
    }

    if (foundGood) continue;

    // No good predicate. Fire on this group.
    const aliasList = Array.from(identifiers).join(', ');
    const aliasOrTable = group[0]?.alias ?? relname;
    void aliasOrTable; // (kept for future detail variants)

    const reasonClause = foundAnyRelevant
      ? 'the predicates connecting them are tautological or compare ' +
        'the same column on both sides'
      : 'no predicate connects them';

    const result: Catch = {
      code: 'SQL-002',
      title: 'Self-join without disambiguating predicate',
      severity: 'warn',
      confidence: 75,
      detail:
        `Table \`${relname}\` appears ${group.length} times in FROM (` +
        `aliases: ${aliasList}), but ${reasonClause}. The query may ` +
        `produce duplicated rows or a cartesian-shaped result for ` +
        `matching rows.`,
      fix:
        'Verify the join predicate connects DIFFERENT columns of the ' +
        'two table references (e.g. `parent.id = child.parent_id`). If ' +
        'you genuinely want all-pairs of rows from the same table, use ' +
        '`CROSS JOIN` to express that intent explicitly.',
      threatCategories: ['integrity'],
    };
    return result;
  }

  return null;
};

/**
 * Collect every A_Expr node found inside the fromClause subtree
 * (JoinExpr quals) and the whereClause. Returned as an array of
 * the A_Expr inner objects (already unwrapped from `{ A_Expr: ... }`).
 */
function collectComparisons(
  fromClause: unknown,
  whereClause: unknown,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown): void => {
    astWalk(node, (n) => {
      if (!n || typeof n !== 'object') return undefined;
      if ('A_Expr' in (n as Record<string, unknown>)) {
        out.push(
          (n as { A_Expr: Record<string, unknown> }).A_Expr,
        );
      }
      return undefined;
    });
  };
  visit({ fromClause });
  if (whereClause !== undefined) visit(whereClause);
  return out;
}

function classifyComparison(
  aexpr: Record<string, unknown>,
  identifiers: ReadonlySet<string>,
): Classification {
  const left = getColumnInfo(aexpr['lexpr']);
  const right = getColumnInfo(aexpr['rexpr']);

  const leftInGroup =
    left.alias !== null && identifiers.has(left.alias);
  const rightInGroup =
    right.alias !== null && identifiers.has(right.alias);

  if (!leftInGroup || !rightInGroup) return 'unrelated';
  if (left.alias === right.alias) return 'tautology';
  if (left.column !== null && left.column === right.column) return 'same-column';
  return 'good';
}

function getColumnInfo(expr: unknown): ColumnInfo {
  if (!expr || typeof expr !== 'object') return { alias: null, column: null };
  if (!('ColumnRef' in (expr as Record<string, unknown>))) {
    return { alias: null, column: null };
  }
  const cr = (expr as { ColumnRef: { fields?: unknown[] } }).ColumnRef;
  const fields = cr.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return { alias: null, column: null };
  }
  if (fields.length === 1) {
    // Bare column ref: `id` — no alias info.
    return { alias: null, column: stringField(fields[0]) };
  }
  // Multi-field: [alias, col] or [schema, table, col]. The alias we
  // care about is the LAST-but-one field (the immediate qualifier
  // of the column).
  const colField = fields[fields.length - 1];
  const aliasField = fields[fields.length - 2];
  return {
    alias: stringField(aliasField),
    column: stringField(colField),
  };
}

function stringField(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as { String?: { sval?: string }; A_Star?: unknown };
  if (f.A_Star) return '*';
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}
