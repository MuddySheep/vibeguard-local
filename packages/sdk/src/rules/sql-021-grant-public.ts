// SQL-021 — GRANT ... TO PUBLIC (over-broad permission widening).
  //
  // Severity:    warn (confidence 90)
  // Threat:      exfiltration
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   GrantStmt with is_grant === true (REVOKE has is_grant absent or
  //   false) and at least one entry in `grantees` whose RoleSpec
  //   roletype === 'ROLESPEC_PUBLIC'.
  //
  // Why warn / 90: PUBLIC includes every current and future role in
  // the database; granting to it is almost always over-broad relative
  // to the agent's stated intent. The 90 reflects the (rare)
  // legitimate uses (granting EXECUTE on a deliberately-public helper
  // function).

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_021: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['GrantStmt']))) return null;
    let fired = false;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('GrantStmt' in obj)) return undefined;
      const stmt = obj['GrantStmt'] as Record<string, unknown>;
      if (stmt['is_grant'] !== true) return undefined;
      const grantees = stmt['grantees'];
      if (!Array.isArray(grantees)) return undefined;
      for (const g of grantees) {
        if (!g || typeof g !== 'object') continue;
        const ro = (g as Record<string, unknown>)['RoleSpec'];
        if (!ro || typeof ro !== 'object') continue;
        if ((ro as Record<string, unknown>)['roletype'] === 'ROLESPEC_PUBLIC') {
          fired = true;
          return 'stop';
        }
      }
      return undefined;
    });
    if (!fired) return null;
    const result: Catch = {
      code: 'SQL-021',
      title: `GRANT ... TO PUBLIC — over-broad permission`,
      severity: 'warn',
      confidence: 90,
      detail:
        `GRANT ... TO PUBLIC widens the privilege to every current and ` +
        `future role in the database. Once granted, every new role ` +
        `automatically receives the privilege; revoking it later ` +
        `requires also revoking from every role that has been created ` +
        `since. This is almost always over-broad relative to the ` +
        `agent's stated intent.`,
      fix:
        `Replace PUBLIC with the specific role(s) that need the ` +
        `privilege (e.g. \`GRANT SELECT ON users TO app_reader\`). For ` +
        `legitimately public helpers (e.g. a UDF anyone may call), ` +
        `document the PUBLIC grant in the migration so future operators ` +
        `know it is intentional.`,
      threatCategories: ['exfiltration'],
    };
    return result;
  };
  