// SQL-023 — pg_terminate_backend / pg_cancel_backend (session-killing DoS).
//
// Severity:    warn (confidence 85)
// Threat:      denial-of-service
// Default:     ON
// Stable since: 1.1.0
//
// Pattern:
//   FuncCall whose funcname (last segment, schema-qualified or bare)
//   is 'pg_terminate_backend' or 'pg_cancel_backend'. Both functions
//   forcibly disconnect or cancel another session — used in bulk
//   against pg_stat_activity they are a one-shot DoS primitive.
//
// Why warn (not block): operators legitimately use these functions to
// kill a runaway query or evict a stuck session. The threat is the
// agent-issued bulk variant (SELECT pg_terminate_backend(pid) FROM
// pg_stat_activity) but the same FuncCall is also the right way to
// kill ONE backend.
//
// Schema-qualified `pg_catalog.pg_terminate_backend(...)` matches —
// the func-name extractor reads the LAST funcname segment.

import type { Catch, Rule } from '../types.js';
import { firstFuncNameMatch } from './func-names.js';

const TARGET_FUNCS = new Set(['pg_terminate_backend', 'pg_cancel_backend']);

// No top-level statement gate: these functions can appear inside any
// expression-bearing statement (INSERT … SELECT, UPDATE … SET col = …,
// EXPLAIN SELECT …). The shared WeakMap-memoized `extractFuncNames`
// pays the AST-walk cost ONCE per analyze() call across SQL-023/028/
// 029/030, and `firstFuncNameMatch` is then a Set lookup.
export const SQL_023: Rule = (ast) => {
  const fired = firstFuncNameMatch(ast, TARGET_FUNCS);
  if (!fired) return null;
  const verb = fired === 'pg_terminate_backend' ? 'pg_terminate_backend' : 'pg_cancel_backend';
  const action = fired === 'pg_terminate_backend' ? 'forcibly disconnects' : 'cancels the active query of';
  const result: Catch = {
    code: 'SQL-023',
    title: `${verb} — session-control DoS primitive`,
    severity: 'warn',
    confidence: 85,
    detail:
      `${verb}() ${action} another Postgres session. Used in bulk ` +
      `against \`pg_stat_activity\` it is a one-shot DoS primitive: ` +
      `every other session is disconnected or has its query killed. ` +
      `Even single-pid uses are unusual outside of operator workflows.`,
    fix:
      `If the agent genuinely needs to kill a runaway query, scope the ` +
      `call to a specific pid (\`SELECT ${verb}(${'12345'}::int)\`) and ` +
      `add \`AND pid <> pg_backend_pid()\` to any \`FROM ` +
      `pg_stat_activity\` filter so the agent does not kill its own ` +
      `session in transit. For most workflows the right answer is to ` +
      `route session-control through an operator dashboard rather ` +
      `than agent-issued SQL.`,
    threatCategories: ['denial-of-service'],
  };
  return result;
};
