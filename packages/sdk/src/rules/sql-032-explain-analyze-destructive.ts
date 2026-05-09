// SQL-032 — EXPLAIN ANALYZE wrapping a destructive statement.
  //
  // Severity:    info (confidence 80)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   ExplainStmt whose options contain a DefElem with defname 'analyze'
  //   AND whose inner query is one of:
  //     InsertStmt, UpdateStmt, DeleteStmt, MergeStmt
  //
  // EXPLAIN ANALYZE is documented to actually execute the statement
  // being explained (it measures real timing). Many operators read
  // "EXPLAIN" and assume it is read-only — but EXPLAIN ANALYZE on a
  // DELETE really deletes the rows. The "ANALYZE" keyword acts as a
  // silent destructiveness modifier.
  //
  // Why info / 80: there is some legitimate use (operators measuring
  // the cost of a planned DML inside an explicit transaction with
  // ROLLBACK at the end). The 20 points of slack are for that case.
  //
  // Out of scope: plain EXPLAIN (no ANALYZE) — read-only by definition.
  // EXPLAIN ANALYZE SELECT — read-only target. EXPLAIN (BUFFERS) X
  // without ANALYZE — read-only.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  const DESTRUCTIVE_INNER = new Set(['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt']);

  export const SQL_032: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['ExplainStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('ExplainStmt' in obj)) return undefined;
      const stmt = obj['ExplainStmt'] as Record<string, unknown>;
      const opts = stmt['options'];
      if (!Array.isArray(opts)) return undefined;
      let hasAnalyze = false;
      for (const o of opts) {
        if (!o || typeof o !== 'object') continue;
        const de = (o as Record<string, unknown>)['DefElem'];
        if (!de || typeof de !== 'object') continue;
        if ((de as Record<string, unknown>)['defname'] === 'analyze') {
          hasAnalyze = true;
          break;
        }
      }
      if (!hasAnalyze) return undefined;
      const q = stmt['query'];
      if (!q || typeof q !== 'object') return undefined;
      for (const k of Object.keys(q as object)) {
        if (DESTRUCTIVE_INNER.has(k)) {
          fired = k;
          return 'stop';
        }
      }
      return undefined;
    });
    if (!fired) return null;
    const innerKind: string = fired;
    const verb = innerKind === 'InsertStmt'
      ? 'INSERT'
      : innerKind === 'UpdateStmt'
        ? 'UPDATE'
        : innerKind === 'DeleteStmt'
          ? 'DELETE'
          : 'MERGE';
    const result: Catch = {
      code: 'SQL-032',
      title: `EXPLAIN ANALYZE ${verb} — really executes the statement`,
      severity: 'info',
      confidence: 80,
      detail:
        `EXPLAIN ANALYZE actually runs the statement to measure real ` +
        `timing — \`EXPLAIN ANALYZE ${verb} …\` really performs the ${verb}. ` +
        `Many operators read "EXPLAIN" and assume read-only; the ANALYZE ` +
        `keyword acts as a silent destructiveness modifier.`,
      fix:
        `If you wanted a read-only plan, drop the ANALYZE keyword ` +
        `(\`EXPLAIN ${verb} …\`). If you genuinely need timing data for ` +
        `a destructive statement, wrap it in an explicit transaction ` +
        `with ROLLBACK so the changes do not persist: \`BEGIN; EXPLAIN ` +
        `ANALYZE ${verb} …; ROLLBACK;\`.`,
      threatCategories: ['destruction'],
    };
    return result;
  };
  