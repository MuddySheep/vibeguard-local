// SQL-022 — CREATE/ALTER ROLE … SUPERUSER (privilege escalation).
  //
  // Severity:    block (confidence 95)
  // Threat:      injection
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   CreateRoleStmt or AlterRoleStmt whose options array contains a
  //   DefElem with defname === 'superuser' and arg.Boolean.boolval === true.
  //   (NOSUPERUSER appears as defname 'superuser' with boolval === false
  //   — must NOT fire.)
  //
  // Why block / 95: SUPERUSER bypasses every permission check in
  // Postgres including row-level security, GRANT/REVOKE, and the
  // LANGUAGE-trust whitelist. Once granted it provides a permanent
  // privilege-escalation primitive — there is essentially no agent
  // workflow that should issue it. The 5 points of slack are for the
  // (operator-only) initial bootstrap of a deliberate superuser role.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  interface SuperuserInfo {
    readonly verb: 'CREATE ROLE' | 'ALTER ROLE';
    readonly rolename: string;
  }

  export const SQL_022: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['CreateRoleStmt', 'AlterRoleStmt']))) return null;
    let fired: SuperuserInfo | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      let stmt: Record<string, unknown> | null = null;
      let verb: 'CREATE ROLE' | 'ALTER ROLE' | null = null;
      if ('CreateRoleStmt' in obj) {
        stmt = obj['CreateRoleStmt'] as Record<string, unknown>;
        verb = 'CREATE ROLE';
      } else if ('AlterRoleStmt' in obj) {
        stmt = obj['AlterRoleStmt'] as Record<string, unknown>;
        verb = 'ALTER ROLE';
      } else {
        return undefined;
      }
      const opts = stmt['options'];
      if (!Array.isArray(opts)) return undefined;
      let hasSuperuser = false;
      for (const o of opts) {
        if (!o || typeof o !== 'object') continue;
        const de = (o as Record<string, unknown>)['DefElem'];
        if (!de || typeof de !== 'object') continue;
        const d = de as Record<string, unknown>;
        if (d['defname'] !== 'superuser') continue;
        const arg = d['arg'];
        if (arg && typeof arg === 'object') {
          const b = (arg as Record<string, unknown>)['Boolean'];
          if (b && typeof b === 'object' && (b as Record<string, unknown>)['boolval'] === true) {
            hasSuperuser = true;
            break;
          }
        }
      }
      if (!hasSuperuser) return undefined;
      let rolename = '<unknown>';
      if (verb === 'CREATE ROLE') {
        if (typeof stmt['role'] === 'string') rolename = stmt['role'] as string;
      } else {
        const rs = stmt['role'] as Record<string, unknown> | undefined;
        if (rs && typeof rs['rolename'] === 'string') rolename = rs['rolename'] as string;
      }
      fired = { verb, rolename };
      return 'stop';
    });
    if (!fired) return null;
    const f: SuperuserInfo = fired;
    const result: Catch = {
      code: 'SQL-022',
      title: `${f.verb} ... SUPERUSER — privilege escalation`,
      severity: 'block',
      confidence: 95,
      detail:
        `${f.verb} \`${f.rolename}\` ... SUPERUSER bypasses every ` +
        `permission check in Postgres, including row-level security, ` +
        `GRANT/REVOKE, and the LANGUAGE-trust whitelist for procedural ` +
        `functions. Once granted it provides a permanent privilege-` +
        `escalation primitive — any subsequent agent-issued SQL run ` +
        `as this role can drop tables, install untrusted extensions, ` +
        `or read arbitrary server files.`,
      fix:
        `Drop the SUPERUSER attribute. If the role legitimately needs ` +
        `elevated read or replication access, GRANT one of the named ` +
        `predefined roles instead (e.g. \`pg_read_all_data\`, ` +
        `\`pg_monitor\`, \`pg_write_all_data\`). True superuser bootstrap ` +
        `belongs to a one-off operator workflow, not agent-issued SQL.`,
      threatCategories: ['injection'],
    };
    return result;
  };
  