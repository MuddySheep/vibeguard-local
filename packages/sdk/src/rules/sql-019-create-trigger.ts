// SQL-019 — CREATE TRIGGER (hidden side effect).
  //
  // Severity:    info (confidence 75)
  // Threat:      integrity
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   Any CreateTrigStmt. (CreateEventTrigStmt is a different shape and
  //   not caught here — DDL-event triggers have a much narrower abuse
  //   surface and an operator-only install pattern.)
  //
  // Why info, not warn: CREATE TRIGGER is sometimes a perfectly normal
  // migration step (audit logging, default-column maintenance). The
  // threat is that a trigger is an invisible piece of behavior the agent
  // can install in one statement and that runs forever after on every
  // matching row event — easy to slip into a migration bundle, hard to
  // notice in subsequent logs.
  //
  // Why 75 confidence: the AST signal is unambiguous (it's a CREATE
  // TRIGGER); the 25 points of slack are for the legitimate-trigger
  // case.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  interface TriggerInfo {
    readonly trigname: string;
    readonly relname: string;
    readonly replace: boolean;
  }

  export const SQL_019: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['CreateTrigStmt']))) return null;
    let fired: TriggerInfo | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('CreateTrigStmt' in obj)) return undefined;
      const stmt = obj['CreateTrigStmt'] as Record<string, unknown>;
      const rel = stmt['relation'] as Record<string, unknown> | undefined;
      fired = {
        trigname: typeof stmt['trigname'] === 'string' ? (stmt['trigname'] as string) : '<unknown>',
        relname: typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>',
        replace: stmt['replace'] === true,
      };
      return 'stop';
    });
    if (!fired) return null;
    const f: TriggerInfo = fired;
    const verb = f.replace ? 'CREATE OR REPLACE TRIGGER' : 'CREATE TRIGGER';
    const result: Catch = {
      code: 'SQL-019',
      title: `${verb} — hidden side effect on every matching row event`,
      severity: 'info',
      confidence: 75,
      detail:
        `${verb} \`${f.trigname}\` on \`${f.relname}\` installs procedural ` +
        `code that runs on every matching row event from now on. From ` +
        `an agent's perspective this is a permanent, invisible ` +
        `control-flow change — the trigger keeps firing long after the ` +
        `migration that installed it has been forgotten.`,
      fix:
        `Verify the trigger is intended. If you are migrating logic into ` +
        `a trigger, confirm the trigger function's body is safe (it can ` +
        `call PERFORM dblink(...), read pg_read_server_files(...), or ` +
        `escalate via SECURITY DEFINER). Document the trigger in the ` +
        `migration log so future operators know it exists.`,
      threatCategories: ['integrity'],
    };
    return result;
  };
  