// SQL-029 — outbound network: dblink / dblink_connect / CREATE SERVER.
//
// Severity:    warn (confidence 80)
// Threat:      exfiltration
// Default:     ON
// Stable since: 1.1.0
//
// Pattern (any of):
//   - FuncCall whose last funcname segment is 'dblink_connect',
//     'dblink', 'dblink_exec', or 'dblink_open' (case-insensitive,
//     schema-qualified matches).
//   - CreateForeignServerStmt (any) — CREATE SERVER attaches a foreign
//     data wrapper that can subsequently be queried as a normal table.
//
// Why warn / 80: dblink_connect and CREATE SERVER are the documented
// ways to make a Postgres server reach out to another host. Used
// inside an agent prompt they are an exfiltration primitive — query
// data here, send it there. The 20 points of slack reflect that some
// data-warehouse / federation setups legitimately rely on
// postgres_fdw + CREATE SERVER as part of normal app operation.
//
// Out of scope: DROP SERVER (cleanup, no outbound traffic), reads of
// pg_foreign_server (read-only).

import type { Catch, Rule } from '../types.js';
import { firstFuncNameMatch } from './func-names.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';

const DBLINK_FUNCS = new Set(['dblink_connect', 'dblink', 'dblink_exec', 'dblink_open']);

export const SQL_029: Rule = (ast) => {
  // CreateForeignServerStmt is a top-level statement — fast O(1) check.
  // dblink functions can appear in any expression-bearing context
  // (INSERT … SELECT dblink(…), UPDATE … SET col = dblink(…), etc.) so
  // they are NOT gated on top-level statement kind; the shared
  // `extractFuncNames` cache absorbs the AST walk cost across all four
  // FuncCall-pattern rules.
  //
  // Reporting precedence when both are present in a multi-statement
  // input: SERVER variant wins (it represents the persistent
  // configuration; the dblink call is the use of it).
  const hasServer = hasTopLevelStmt(ast, new Set(['CreateForeignServerStmt']));
  let kind: 'dblink' | 'server' | null = null;
  let name = '';
  if (hasServer) {
    kind = 'server';
  } else {
    const fn = firstFuncNameMatch(ast, DBLINK_FUNCS);
    if (fn) {
      kind = 'dblink';
      name = fn;
    }
  }
  if (!kind) return null;

  const isServer = kind === 'server';
  const result: Catch = {
    code: 'SQL-029',
    title: isServer
      ? 'CREATE SERVER — outbound foreign-data wrapper'
      : `${name}() — outbound network call`,
    severity: 'warn',
    confidence: 80,
    detail: isServer
      ? `CREATE SERVER attaches a foreign data wrapper to a remote ` +
        `host; subsequent queries against foreign tables on this server ` +
        `make outbound network calls from the database. Created from ` +
        `agent-issued SQL it is an exfiltration channel — query data ` +
        `here, route it through the foreign server.`
      : `${name}() makes an outbound network call from ` +
        `the database server to another host. Used inside an agent prompt ` +
        `it is an exfiltration primitive: query data here, send it there.`,
    fix:
      `Outbound network capability belongs in the application layer, ` +
      `not in agent-issued SQL. If the workflow genuinely needs to ` +
      `federate across databases, route the connection through a ` +
      `pre-provisioned, operator-owned FOREIGN SERVER + USER MAPPING ` +
      `whose endpoints are not agent-controllable.`,
    threatCategories: ['exfiltration'],
  };
  return result;
};
