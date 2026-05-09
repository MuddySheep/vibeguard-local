// SQL-027 — SET search_path with non-pg_catalog-first entry.
  //
  // Severity:    warn (confidence 85)
  // Threat:      injection
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   VariableSetStmt with name === 'search_path', kind === 'VAR_SET_VALUE',
  //   whose first arg (an A_Const sval) is anything other than 'pg_catalog'.
  //   Putting a writable schema (`public`, `$user`, an attacker-controlled
  //   schema) before pg_catalog lets a malicious operator-installed
  //   function shadow built-in operators (CVE-2018-1058 pattern).
  //
  // Why warn / 85: this is the documented PostgreSQL recommendation
  // ("schema search path should always start with pg_catalog"). The
  // 15 points of slack reflect that many legitimate apps SET
  // search_path = public, pg_catalog at session start without realizing
  // they are the wrong way around.
  //
  // Out of scope: VAR_RESET (RESET search_path), SHOW search_path,
  // statement-level `pg_catalog, pg_temp` (the safe ordering).

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  export const SQL_027: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['VariableSetStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired !== null) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('VariableSetStmt' in obj)) return undefined;
      const stmt = obj['VariableSetStmt'] as Record<string, unknown>;
      if (stmt['name'] !== 'search_path') return undefined;
      if (stmt['kind'] !== 'VAR_SET_VALUE') return undefined;
      const args = stmt['args'];
      if (!Array.isArray(args) || args.length === 0) return undefined;
      const first = args[0];
      if (!first || typeof first !== 'object') return undefined;
      const c = (first as Record<string, unknown>)['A_Const'];
      if (!c || typeof c !== 'object') return undefined;
      const sv = (c as Record<string, unknown>)['sval'];
      if (!sv || typeof sv !== 'object') return undefined;
      const val = (sv as Record<string, unknown>)['sval'];
      if (typeof val !== 'string') return undefined;
      if (val === 'pg_catalog') return undefined;
      fired = val;
      return 'stop';
    });
    if (fired === null) return null;
    const firstSchema: string = fired;
    const result: Catch = {
      code: 'SQL-027',
      title: `SET search_path puts \`${firstSchema}\` before pg_catalog — operator-shadowing risk`,
      severity: 'warn',
      confidence: 85,
      detail:
        `SET search_path = ${firstSchema}, ... places a writable schema ` +
        `ahead of pg_catalog. A function or operator defined in ` +
        `\`${firstSchema}\` with a built-in name (e.g. an \`=(int,int)\` ` +
        `overload, or a \`pg_get_indexdef(oid)\` shadow) will be resolved ` +
        `first — the CVE-2018-1058 pattern. Any subsequent SQL run in ` +
        `this session can be silently rewritten by the shadowed object.`,
      fix:
        `Put pg_catalog first: \`SET search_path = pg_catalog, ${firstSchema}\` ` +
        `(or the safer fully-qualified call style: \`SET search_path = ` +
        `pg_catalog, pg_temp\` and qualify your own object names). The ` +
        `Postgres documentation recommends pg_catalog always lead.`,
      threatCategories: ['injection'],
    };
    return result;
  };
  