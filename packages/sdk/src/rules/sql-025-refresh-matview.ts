// SQL-025 — REFRESH MATERIALIZED VIEW (non-concurrent).
  //
  // Severity:    warn (confidence 75)
  // Threat:      denial-of-service
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   RefreshMatViewStmt with concurrent !== true.
  //
  // Why warn / 75: a non-concurrent REFRESH takes an ACCESS EXCLUSIVE
  // lock on the materialized view and blocks every reader until the
  // refresh finishes. On a large MV that is an avoidable production
  // stall — the CONCURRENTLY variant exists precisely for this reason
  // (it costs more CPU but never blocks readers).
  //
  // The 25 points of slack reflect the legitimate cases: MVs not yet
  // populated (CONCURRENTLY requires a unique index and at least one
  // previous full refresh), and one-off cold-start refreshes where no
  // readers exist.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_025: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['RefreshMatViewStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('RefreshMatViewStmt' in obj)) return undefined;
      const stmt = obj['RefreshMatViewStmt'] as Record<string, unknown>;
      if (stmt['concurrent'] === true) return undefined;
      const rel = stmt['relation'] as Record<string, unknown> | undefined;
      fired = typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>';
      return 'stop';
    });
    if (!fired) return null;
    const mv: string = fired;
    const result: Catch = {
      code: 'SQL-025',
      title: `REFRESH MATERIALIZED VIEW — blocking refresh`,
      severity: 'warn',
      confidence: 75,
      detail:
        `REFRESH MATERIALIZED VIEW \`${mv}\` (without CONCURRENTLY) takes ` +
        `an ACCESS EXCLUSIVE lock on the view and blocks every reader ` +
        `until the refresh finishes. On a large MV that is a substantial ` +
        `production stall — the CONCURRENTLY variant exists precisely to ` +
        `avoid it.`,
      fix:
        `Use \`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}\` instead. ` +
        `CONCURRENTLY requires the view to have at least one UNIQUE index ` +
        `and to have been populated by a prior non-concurrent refresh; ` +
        `once those one-time prerequisites are met every subsequent ` +
        `refresh can be online.`,
      threatCategories: ['denial-of-service'],
    };
    return result;
  };
  