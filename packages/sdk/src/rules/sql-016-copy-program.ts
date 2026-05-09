// SQL-016 — COPY FROM/TO PROGRAM (server-side RCE primitive).
  //
  // Severity:    block (confidence 99)
  // Threat:      exfiltration, injection
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   CopyStmt with is_program === true. The associated string in
  //   `filename` is the shell command Postgres will execute (with
  //   /bin/sh -c) under the postgres OS-user's privileges. Whether the
  //   COPY is FROM (read stdout) or TO (feed stdin) does not change the
  //   threat shape — both run an arbitrary command on the database host.
  //
  // Why block / 99: COPY ... PROGRAM is a documented superuser-only
  // feature precisely because it is server-side RCE. There is
  // essentially no agent workflow that should issue this.
  //
  // Multi-statement: fires on the first CopyStmt with is_program; if
  // later statements also do so they are not separately enumerated
  // (the threat is the same once any program-COPY is present).

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_016: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['CopyStmt']))) return null;
    let fired: { command: string; isFrom: boolean } | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('CopyStmt' in obj)) return undefined;
      const stmt = obj['CopyStmt'] as Record<string, unknown>;
      if (stmt['is_program'] !== true) return undefined;
      fired = {
        command: typeof stmt['filename'] === 'string' ? stmt['filename'] : '<unknown>',
        isFrom: stmt['is_from'] === true,
      };
      return 'stop';
    });
    if (!fired) return null;
    const f: { command: string; isFrom: boolean } = fired;
    const result: Catch = {
      code: 'SQL-016',
      title: f.isFrom ? 'COPY ... FROM PROGRAM — server-side RCE' : 'COPY ... TO PROGRAM — server-side RCE',
      severity: 'block',
      confidence: 99,
      detail:
        `COPY ... ${f.isFrom ? 'FROM' : 'TO'} PROGRAM '${f.command}' ` +
        `runs an arbitrary shell command on the database host under ` +
        `the postgres OS-user's privileges (Postgres invokes /bin/sh -c ` +
        `on the program string). It is documented superuser-only ` +
        `because it is RCE — there is essentially no agent workflow ` +
        `that should issue this.`,
      fix:
        `Replace COPY ... PROGRAM with one of: COPY ... TO STDOUT / FROM ` +
        `STDIN (driver-side streaming, no server-side shell), COPY ... ` +
        `TO/FROM '<file path>' (no shell expansion), or read/write the ` +
        `data via the application instead of the database.`,
      threatCategories: ['exfiltration', 'injection'],
    };
    return result;
  };
  