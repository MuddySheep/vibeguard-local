// SQL-020 — CREATE OR REPLACE FUNCTION (silent overwrite signal).
  //
  // Severity:    info (confidence 70)
  // Threat:      integrity
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   CreateFunctionStmt with replace === true. The catch fires on the
  //   syntax (the agent's stated intent to overwrite) — we cannot tell
  //   from a single statement whether the previous function existed.
  //
  // Why info / 70: most CREATE OR REPLACE FUNCTION uses are routine
  // migrations (re-applying the same body, refining a helper). The
  // catch is a low-confidence reminder to confirm the overwrite is
  // intentional, especially if the function name matches an existing
  // SECURITY DEFINER function whose body is being replaced.
  //
  // Out of scope: CREATE OR REPLACE VIEW (different statement shape,
  // ViewStmt with replace: true), CREATE OR REPLACE PROCEDURE (covered
  // by the same Postgres parser as functions, but PROCEDURE is rarely
  // used in agent-issued SQL today).

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_020: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['CreateFunctionStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('CreateFunctionStmt' in obj)) return undefined;
      const stmt = obj['CreateFunctionStmt'] as Record<string, unknown>;
      if (stmt['replace'] !== true) return undefined;
      const fn = stmt['funcname'];
      if (Array.isArray(fn)) {
        const parts: string[] = [];
        for (const it of fn) {
          if (it && typeof it === 'object') {
            const s = (it as Record<string, unknown>)['String'];
            if (s && typeof s === 'object') {
              const sval = (s as Record<string, unknown>)['sval'];
              if (typeof sval === 'string') parts.push(sval);
            }
          }
        }
        fired = parts.length > 0 ? parts.join('.') : '<unknown>';
      } else {
        fired = '<unknown>';
      }
      return 'stop';
    });
    if (!fired) return null;
    const fname: string = fired;
    const result: Catch = {
      code: 'SQL-020',
      title: `CREATE OR REPLACE FUNCTION — silent overwrite`,
      severity: 'info',
      confidence: 70,
      detail:
        `\`CREATE OR REPLACE FUNCTION ${fname}\` silently overwrites any ` +
        `existing function with the same signature. If a SECURITY DEFINER ` +
        `function with that name already exists, the OR REPLACE swaps in ` +
        `the new body without further confirmation. Static analysis ` +
        `cannot tell whether a previous function existed — the catch ` +
        `fires on the agent's stated intent to overwrite.`,
      fix:
        `If you do not intend to overwrite an existing function, drop ` +
        `the OR REPLACE keyword — Postgres will refuse the statement if ` +
        `a function with that signature already exists, surfacing the ` +
        `collision instead of hiding it.`,
      threatCategories: ['integrity'],
    };
    return result;
  };
  