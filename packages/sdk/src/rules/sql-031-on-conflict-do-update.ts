// SQL-031 — INSERT … SELECT … ON CONFLICT DO UPDATE (mass overwrite).
  //
  // Severity:    info (confidence 75)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   InsertStmt with onConflictClause.action === 'ONCONFLICT_UPDATE',
  //   selectStmt is a SELECT (has fromClause, not valuesLists), and the
  //   inner SELECT has no LIMIT clause.
  //
  // The shape is "for every row produced by an unbounded SELECT, upsert
  // it" — when the source overlaps the target it is a full-table
  // overwrite expressed through INSERT syntax, bypassing SQL-001's
  // blanket UPDATE/DELETE catches.
  //
  // Why info / 75: many ON CONFLICT DO UPDATE statements are routine
  // upserts of single VALUES rows (negative); the dangerous shape is
  // specifically SELECT … without LIMIT. The 25 points of slack reflect
  // the legitimate batch-import pattern (which the operator should
  // confirm is intentional).
  //
  // Out of scope:
  //   - VALUES-based INSERTs (always single-row or small batch)
  //   - LIMIT-bounded SELECTs (operator-bounded mass)
  //   - ON CONFLICT DO NOTHING (idempotent, no overwrite)

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_031: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['InsertStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('InsertStmt' in obj)) return undefined;
      const stmt = obj['InsertStmt'] as Record<string, unknown>;
      const occ = stmt['onConflictClause'] as Record<string, unknown> | undefined;
      if (!occ || occ['action'] !== 'ONCONFLICT_UPDATE') return undefined;
      const sel = stmt['selectStmt'] as Record<string, unknown> | undefined;
      if (!sel) return undefined;
      const inner = sel['SelectStmt'] as Record<string, unknown> | undefined;
      if (!inner) return undefined;
      if ('valuesLists' in inner) return undefined; // VALUES-based, not mass
      if (!Array.isArray(inner['fromClause']) || inner['fromClause'].length === 0) return undefined;
      if ('limitCount' in inner && inner['limitCount']) return undefined;
      const rel = stmt['relation'] as Record<string, unknown> | undefined;
      fired = typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>';
      return 'stop';
    });
    if (!fired) return null;
    const target: string = fired;
    const result: Catch = {
      code: 'SQL-031',
      title: 'INSERT … SELECT … ON CONFLICT DO UPDATE — unbounded upsert',
      severity: 'info',
      confidence: 75,
      detail:
        `INSERT INTO \`${target}\` SELECT … ON CONFLICT DO UPDATE will ` +
        `upsert every row produced by the inner SELECT. With no LIMIT ` +
        `bound and a SELECT source that overlaps the target, this is a ` +
        `full-table overwrite expressed through INSERT syntax — the same ` +
        `threat shape SQL-001 catches for blanket UPDATE/DELETE, just ` +
        `routed through INSERT.`,
      fix:
        `Add a LIMIT to the inner SELECT to bound the mutation, or ` +
        `replace the upsert with an explicit UPDATE whose WHERE clause ` +
        `makes the affected rows visible. If the unbounded upsert is a ` +
        `deliberate batch import, document it in the migration so future ` +
        `operators know it is intentional.`,
      threatCategories: ['destruction'],
    };
    return result;
  };
  