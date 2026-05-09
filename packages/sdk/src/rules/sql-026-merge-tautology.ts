// SQL-026 — MERGE with a tautological ON clause.
  //
  // Severity:    block (confidence 90)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   MergeStmt whose joinCondition reduces to a literal tautology
  //   (`1=1`, `true`, `'a'='a'`, `s.id = s.id`, `NOT false`).
  //   A tautological ON matches every row of the source against every
  //   row of the target — combined with WHEN MATCHED THEN UPDATE/DELETE
  //   that is a full-table mutation in disguise.
  //
  // Why block / 90: The shape is identical to SQL-001's blanket
  // UPDATE/DELETE catches but expressed through MERGE syntax that
  // bypasses those rules. The 10 points of slack reflect the (rare)
  // legitimate case where a MERGE genuinely targets every row.
  //
  // Tautology detection uses the shared isLiteralTautology helper.
  // The helper deliberately does not unwrap AND/OR — a tautology
  // that is one branch of `tautology AND realPredicate` is not a
  // tautology of the whole expression and the rule must not fire.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';
  import { isLiteralTautology } from './is-tautology.js';

  export const SQL_026: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['MergeStmt']))) return null;
    let fired = false;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('MergeStmt' in obj)) return undefined;
      const stmt = obj['MergeStmt'] as Record<string, unknown>;
      const joinCond = stmt['joinCondition'];
      if (isLiteralTautology(joinCond)) {
        fired = true;
        return 'stop';
      }
      return undefined;
    });
    if (!fired) return null;
    const result: Catch = {
      code: 'SQL-026',
      title: 'MERGE with tautological ON — full-table mutation in disguise',
      severity: 'block',
      confidence: 90,
      detail:
        'MERGE INTO ... ON <tautology> matches every source row against ' +
        'every target row. Combined with WHEN MATCHED THEN UPDATE or DELETE ' +
        'this is a blanket mutation expressed through MERGE syntax — the ' +
        'same threat shape that SQL-001 catches for UPDATE/DELETE, just ' +
        'routed through a statement type that bypasses those rules.',
      fix:
        'Replace the tautological ON with a real join condition that ' +
        'identifies the rows you intend to merge (e.g. `ON target.id = ' +
        'source.id`). If you genuinely intend to mutate every target row, ' +
        'route the change through an explicit UPDATE/DELETE so the intent ' +
        'is visible in the SQL.',
      threatCategories: ['destruction'],
    };
    return result;
  };
  