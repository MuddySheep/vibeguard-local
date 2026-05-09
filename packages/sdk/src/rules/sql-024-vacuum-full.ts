// SQL-024 — VACUUM FULL (ACCESS EXCLUSIVE outage).
  //
  // Severity:    warn (confidence 80)
  // Threat:      denial-of-service
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   VacuumStmt with is_vacuumcmd === true and an option DefElem with
  //   defname === 'full'. (`VACUUM (FULL, ANALYZE) t` produces two
  //   options entries; the rule fires whenever 'full' is among them.)
  //
  // Why warn / 80: VACUUM FULL takes an ACCESS EXCLUSIVE lock on its
  // target and rewrites the entire relation. On a busy production
  // table that means a full read/write outage for the duration of the
  // rewrite. The 20 points of slack are for the legitimate maintenance-
  // window case.
  //
  // Out of scope: `VACUUM` (no FULL, no exclusive lock), `VACUUM
  // ANALYZE`, `ANALYZE` (the analyze-only AnalyzeStmt has its own
  // libpg-query node).

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_024: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['VacuumStmt']))) return null;
    let fired = false;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('VacuumStmt' in obj)) return undefined;
      const stmt = obj['VacuumStmt'] as Record<string, unknown>;
      if (stmt['is_vacuumcmd'] !== true) return undefined;
      const opts = stmt['options'];
      if (!Array.isArray(opts)) return undefined;
      for (const o of opts) {
        if (!o || typeof o !== 'object') continue;
        const de = (o as Record<string, unknown>)['DefElem'];
        if (!de || typeof de !== 'object') continue;
        if ((de as Record<string, unknown>)['defname'] === 'full') {
          fired = true;
          return 'stop';
        }
      }
      return undefined;
    });
    if (!fired) return null;
    const result: Catch = {
      code: 'SQL-024',
      title: `VACUUM FULL — ACCESS EXCLUSIVE outage`,
      severity: 'warn',
      confidence: 80,
      detail:
        `VACUUM FULL takes an ACCESS EXCLUSIVE lock on the target relation ` +
        `and rewrites the entire table file. On a busy production table ` +
        `that means every reader and writer blocks until the rewrite ` +
        `finishes — effectively an outage on the table. The classic ` +
        `alternative (\`pg_repack\` or \`VACUUM\` without FULL) avoids the ` +
        `exclusive lock.`,
      fix:
        `If you need to reclaim disk space online, use \`pg_repack\` ` +
        `(extension) or schedule the VACUUM FULL inside a deliberate ` +
        `maintenance window. For routine bloat control, plain \`VACUUM\` ` +
        `(no FULL) takes only a SHARE UPDATE EXCLUSIVE lock and does ` +
        `not block reads or writes.`,
      threatCategories: ['denial-of-service'],
    };
    return result;
  };
  