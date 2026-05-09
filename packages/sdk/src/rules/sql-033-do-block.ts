// SQL-033 — DO $$ ... $$ anonymous code block.
  //
  // Severity:    info (confidence 70)
  // Threat:      injection
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   DoStmt (any). The body of a DO block is an opaque string handed
  //   to a procedural language (default plpgsql) and executed at the
  //   server. From a static-analysis perspective the body is not
  //   visible — we cannot tell whether it contains DROP TABLE,
  //   PERFORM dblink_connect(...), or anything else.
  //
  // Why info / 70: DO blocks are sometimes a normal way to run a
  // one-off bit of plpgsql logic during a migration. The catch is a
  // reminder that this is an analysis blind spot — the agent has just
  // asked the database to execute code we cannot inspect.
  //
  // The 30 points of slack reflect that legitimate uses are common
  // (e.g. one-off data fixes inside transactions). The catch is meant
  // to surface "an unparsed block ran" so an operator can confirm.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_033: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['DoStmt']))) return null;
    let fired = false;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if ('DoStmt' in obj) {
        fired = true;
        return 'stop';
      }
      return undefined;
    });
    if (!fired) return null;
    const result: Catch = {
      code: 'SQL-033',
      title: 'DO $$ … $$ — opaque procedural block',
      severity: 'info',
      confidence: 70,
      detail:
        'A DO block hands an opaque string to a procedural language ' +
        '(default plpgsql) and executes it at the server. From a static-' +
        'analysis perspective the body is not visible — VibeGuard ' +
        'cannot tell whether it contains DROP TABLE, PERFORM ' +
        'dblink_connect(…), or anything else. The agent has asked the ' +
        'database to run code we cannot inspect.',
      fix:
        'If the DO body is a one-off migration step, lift its statements ' +
        'out of the DO block so each is independently visible to static ' +
        'analysis. If the block must remain (e.g. it uses control flow), ' +
        'document what it does and ensure an operator review of the body ' +
        'before merge.',
      threatCategories: ['injection'],
    };
    return result;
  };
  