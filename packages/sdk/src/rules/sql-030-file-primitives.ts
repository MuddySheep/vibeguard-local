// SQL-030 — server-side filesystem primitives.
//
// Severity:    warn (confidence 90)
// Threat:      exfiltration
// Default:     ON
// Stable since: 1.1.0
//
// Pattern:
//   FuncCall whose last funcname segment is one of:
//     - lo_export                 (writes a large object to a server file)
//     - pg_read_server_files      (reads any server file)
//     - pg_read_binary_file       (reads any server file as bytea)
//     - pg_ls_dir                 (lists any server directory)
//   All four functions read or write the database server's filesystem
//   under the postgres OS-user's privileges. They are the canonical
//   "exfiltrate /etc/passwd" primitives.
//
// Why warn / 90: the AST signal is unambiguous (these are all built-in
// FuncCalls with stable names). The 10 points of slack are for the
// rare legitimate operator workflow (e.g. pg_ls_dir on the WAL
// directory for monitoring) — those should still surface a warning so
// the operator can confirm.
//
// Out of scope: lo_create (creates a large object in the database, no
// filesystem access), reads of `pg_largeobject_metadata` itself
// (read-only catalog view).

import type { Catch, Rule } from '../types.js';
import { firstFuncNameMatch } from './func-names.js';

const FILE_FUNCS = new Set([
  'lo_export',
  'pg_read_server_files',
  'pg_read_server_file',
  'pg_read_binary_file',
  'pg_ls_dir',
]);

// No top-level statement gate — see SQL-023 for the rationale.
// `pg_read_server_file()` and friends commonly appear in `INSERT INTO
// logs SELECT pg_read_server_file('/etc/passwd')` and
// `UPDATE … SET col = pg_read_server_file(…)` exfiltration patterns.
export const SQL_030: Rule = (ast) => {
  const fired = firstFuncNameMatch(ast, FILE_FUNCS);
  if (!fired) return null;
  const isWrite = fired === 'lo_export';
  const result: Catch = {
    code: 'SQL-030',
    title: `${fired}() — server-side filesystem ${isWrite ? 'write' : 'read'}`,
    severity: 'warn',
    confidence: 90,
    detail:
      `${fired}() ${isWrite ? 'writes to' : 'reads from'} the database ` +
      `server's filesystem under the postgres OS-user's privileges. ` +
      `This is the canonical primitive for ${isWrite ? 'planting attacker payloads on disk' : 'exfiltrating arbitrary server files (e.g. /etc/passwd, configuration files, other databases\' data files)'}.`,
    fix:
      `Server-side file I/O belongs in operator workflows, not agent-` +
      `issued SQL. If the agent genuinely needs to read or write ` +
      `bytes, route the I/O through the application layer instead — ` +
      `it has the right OS-user, the right path scoping, and the right ` +
      `audit trail.`,
    threatCategories: ['exfiltration'],
  };
  return result;
};
