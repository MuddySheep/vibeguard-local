// SQL-036 — DELETE … USING without a join predicate.
  //
  // Severity:    block (confidence 90)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   DeleteStmt with a non-empty usingClause AND a whereClause that
  //   does not qualify any column with a name belonging to one of the
  //   USING-side relations. (Or no whereClause at all.)
  //
  //   The DELETE … USING shape is the DELETE-side mirror of UPDATE …
  //   FROM: USING introduces additional relations whose rows are
  //   joined against the target. Without a join predicate the planner
  //   produces the Cartesian product, and every target row that has
  //   any source-row pairing is deleted — usually every row in the
  //   target table.
  //
  // Why block / 90: same reasoning as SQL-035 — the AST signal is
  // unambiguous, the legitimate-cross-join case is rare. SQL-003
  // already catches the no-USING variant; this rule catches the
  // USING-side blind spot.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';
  import { rangeVarName, whereHasQualifierIn } from './from-join-helpers.js';

  export const SQL_036: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['DeleteStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('DeleteStmt' in obj)) return undefined;
      const stmt = obj['DeleteStmt'] as Record<string, unknown>;
      const usingClause = stmt['usingClause'];
      if (!Array.isArray(usingClause) || usingClause.length === 0) return undefined;
      const usingNames = new Set<string>();
      for (const u of usingClause) {
        const n = rangeVarName(u);
        if (n) usingNames.add(n);
      }
      const whereClause = stmt['whereClause'];
      if (whereClause === undefined || whereClause === null) {
        const rel = stmt['relation'] as Record<string, unknown> | undefined;
        fired = typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>';
        return 'stop';
      }
      if (!whereHasQualifierIn(whereClause, usingNames)) {
        const rel = stmt['relation'] as Record<string, unknown> | undefined;
        fired = typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>';
        return 'stop';
      }
      return undefined;
    });
    if (!fired) return null;
    const target: string = fired;
    const result: Catch = {
      code: 'SQL-036',
      title: 'DELETE … USING without join predicate — silent cross-join wipe',
      severity: 'block',
      confidence: 90,
      detail:
        `DELETE FROM \`${target}\` USING <source> with no WHERE qualifier on ` +
        `the source side takes the Cartesian product of the USING rows ` +
        `and deletes every target row that has any source-row pairing — ` +
        `usually every row in \`${target}\`. SQL-003 catches the no-USING ` +
        `variant; this rule catches the USING-side blind spot.`,
      fix:
        `Add a join predicate that ties target rows to source rows ` +
        `(e.g. \`WHERE ${target}.id = <source>.target_id\`). If you ` +
        `genuinely intend to delete every row in \`${target}\` based on ` +
        `a source-side condition, route it through an explicit DELETE ` +
        `with that condition expressed in the WHERE clause.`,
      threatCategories: ['destruction'],
    };
    return result;
  };
  