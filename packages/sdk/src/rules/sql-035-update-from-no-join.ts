// SQL-035 — UPDATE … FROM without a join predicate.
  //
  // Severity:    block (confidence 90)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   UpdateStmt with a non-empty fromClause AND a whereClause that
  //   does not qualify any column with a name belonging to one of the
  //   FROM-side relations.
  //
  //   With a FROM clause but no join predicate, the planner takes the
  //   Cartesian product of the FROM-side rows and updates the target
  //   for each pair — typically every target row at least once, with
  //   the column value pulled from an arbitrary source row. The damage
  //   is silent: it looks like a normal UPDATE, the row count returned
  //   is large but plausible, and the data is randomized.
  //
  // Why block / 90: the AST signal is unambiguous (we can prove the
  // WHERE has no FROM-side qualifier). The 10 points of slack are for
  // the rare legitimate case (e.g. UPDATE … FROM (single-row
  // subquery) where the source genuinely has one row).
  //
  // Detection algorithm:
  //   1. Collect FROM-side names (alias or relname) of every RangeVar
  //      in fromClause.
  //   2. If whereClause is missing → fire (no predicate at all).
  //   3. Else, walk whereClause for any ColumnRef whose first
  //      qualifier is in the FROM-side names. If none → fire.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';
  import { rangeVarName, whereHasQualifierIn } from './from-join-helpers.js';

  export const SQL_035: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['UpdateStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('UpdateStmt' in obj)) return undefined;
      const stmt = obj['UpdateStmt'] as Record<string, unknown>;
      const fromClause = stmt['fromClause'];
      if (!Array.isArray(fromClause) || fromClause.length === 0) return undefined;
      const fromNames = new Set<string>();
      for (const fr of fromClause) {
        const n = rangeVarName(fr);
        if (n) fromNames.add(n);
      }
      const whereClause = stmt['whereClause'];
      if (whereClause === undefined || whereClause === null) {
        // No predicate at all — pure cross-join.
        const rel = stmt['relation'] as Record<string, unknown> | undefined;
        fired = typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>';
        return 'stop';
      }
      if (!whereHasQualifierIn(whereClause, fromNames)) {
        const rel = stmt['relation'] as Record<string, unknown> | undefined;
        fired = typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>';
        return 'stop';
      }
      return undefined;
    });
    if (!fired) return null;
    const target: string = fired;
    const result: Catch = {
      code: 'SQL-035',
      title: 'UPDATE … FROM without join predicate — silent cross-join overwrite',
      severity: 'block',
      confidence: 90,
      detail:
        `UPDATE \`${target}\` … FROM <source> with no WHERE qualifier on ` +
        `the source side takes the Cartesian product of the source rows ` +
        `and updates the target for each pair. Typically every target ` +
        `row is updated at least once, with the column value pulled from ` +
        `an arbitrary source row. The damage is silent: the row count ` +
        `returned is large but plausible, and the data is randomized.`,
      fix:
        `Add a join predicate that ties target rows to source rows ` +
        `(e.g. \`WHERE ${target}.id = <source>.target_id\`). If the ` +
        `source genuinely has one row and the cross-join is intended, ` +
        `document it — the operator should be able to confirm the row ` +
        `count is bounded.`,
      threatCategories: ['destruction'],
    };
    return result;
  };
  