// SQL-028 — pg_create_logical_replication_slot / pg_create_physical_replication_slot.
//
// Severity:    warn (confidence 80)
// Threat:      exfiltration
// Default:     ON
// Stable since: 1.1.0
//
// Pattern:
//   FuncCall with last funcname segment 'pg_create_logical_replication_slot'
//   or 'pg_create_physical_replication_slot' (case-insensitive,
//   schema-qualified `pg_catalog.…` matches).
//
// Why warn / 80: a replication slot streams every WAL change from the
// database to whoever connects to it. Created inside an agent prompt
// it is an exfiltration channel that survives the prompt — and an
// orphaned slot pins WAL retention indefinitely (DoS by disk).
//
// Out of scope: pg_drop_replication_slot (sometimes appropriate
// cleanup), reads of `pg_replication_slots` (read-only).

import type { Catch, Rule } from '../types.js';
import { firstFuncNameMatch } from './func-names.js';

const TARGET_FUNCS = new Set([
  'pg_create_logical_replication_slot',
  'pg_create_physical_replication_slot',
]);

// No top-level statement gate — see SQL-023 for the rationale (these
// functions can appear inside INSERT/UPDATE/EXPLAIN, and the shared
// `extractFuncNames` cache absorbs the walk cost across all four
// FuncCall-pattern rules).
export const SQL_028: Rule = (ast) => {
  const fired = firstFuncNameMatch(ast, TARGET_FUNCS);
  if (!fired) return null;
  const kind = fired.includes('logical') ? 'logical' : 'physical';
  const result: Catch = {
    code: 'SQL-028',
    title: `${fired}() — replication slot creation`,
    severity: 'warn',
    confidence: 80,
    detail:
      `${fired}() creates a ${kind} replication slot. A slot streams ` +
      `every WAL change from the database to whoever connects to it — ` +
      `an exfiltration channel that survives the SQL session that ` +
      `created it. An orphaned slot also pins WAL retention indefinitely, ` +
      `eventually filling the data disk (DoS).`,
    fix:
      `Create replication slots from an operator workflow, not from ` +
      `agent-issued SQL. If a slot is genuinely needed for an ` +
      `integration, document who owns it and ensure a reaper job will ` +
      `drop it (\`pg_drop_replication_slot\`) if the consumer disappears.`,
    threatCategories: ['exfiltration'],
  };
  return result;
};
