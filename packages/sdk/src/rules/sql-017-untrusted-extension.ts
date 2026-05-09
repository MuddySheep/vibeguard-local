// SQL-017 — CREATE EXTENSION on an untrusted procedural language.
  //
  // Severity:    block (confidence 95)
  // Threat:      injection
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   CreateExtensionStmt whose extname is one of Postgres's documented
  //   "untrusted" PL languages (the U-suffix variants):
  //     plpython3u, plpython2u, plpythonu, plperlu, pltclu, plr, plsh
  //   These languages have no per-language sandbox; functions written
  //   in them run as the postgres OS-user with full filesystem and
  //   network access. Once installed they are a permanent RCE primitive.
  //
  // Why block / 95 (not 99): CREATE EXTENSION on an untrusted PL is a
  // documented capability operators sometimes want — e.g. using
  // plpython3u for a deliberate background-task framework. We block at
  // 95 rather than 99 to leave room for those rare deliberate cases.
  //
  // What this rule does NOT catch: CREATE EXTENSION on TRUSTED
  // languages (plpgsql, plperl, pltcl, sql) and on data extensions
  // (pgcrypto, pg_stat_statements, vector, postgis, etc.).

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  const UNTRUSTED_LANGS = new Set([
    'plpython3u',
    'plpython2u',
    'plpythonu',
    'plperlu',
    'pltclu',
    'plr',
    'plsh',
  ]);

  export const SQL_017: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['CreateExtensionStmt']))) return null;
    let fired: string | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('CreateExtensionStmt' in obj)) return undefined;
      const stmt = obj['CreateExtensionStmt'] as Record<string, unknown>;
      const name = typeof stmt['extname'] === 'string' ? stmt['extname'].toLowerCase() : '';
      if (UNTRUSTED_LANGS.has(name)) {
        fired = name;
        return 'stop';
      }
      return undefined;
    });
    if (!fired) return null;
    const lang: string = fired;
    const result: Catch = {
      code: 'SQL-017',
      title: `CREATE EXTENSION ${lang} — untrusted procedural language`,
      severity: 'block',
      confidence: 95,
      detail:
        `${lang} is a documented "untrusted" Postgres procedural language ` +
        `— functions written in it run as the postgres OS-user with no ` +
        `language-level sandbox (full filesystem and network access). ` +
        `Installing it is a permanent RCE primitive: any subsequent ` +
        `CREATE FUNCTION ... LANGUAGE ${lang} can execute arbitrary ` +
        `shell commands.`,
      fix:
        `Use a TRUSTED procedural language (\`plpgsql\`, \`plperl\`, \`pltcl\`, ` +
        `\`sql\`) if a procedural language is needed. If the agent's plan ` +
        `genuinely needs server-side scripting in a U-language, route ` +
        `the install through an operator-confirmed migration step ` +
        `rather than agent-issued SQL.`,
      threatCategories: ['injection'],
    };
    return result;
  };
  