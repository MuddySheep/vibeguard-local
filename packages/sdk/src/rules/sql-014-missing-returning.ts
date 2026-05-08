// SQL-014 — INSERT / UPDATE / DELETE without RETURNING.
//
// Severity:    info
// Confidence:  50 (deliberately low — fires on every write without
//                  RETURNING, including legitimate fire-and-forget cases)
// Threat:      integrity
// Default:     OFF — opt-in via analyze() options.rules['sql-014'].enabled
//
// Pattern:
//   InsertStmt / UpdateStmt / DeleteStmt with no `returningList` field
//   (or an empty one).
//
// Why this rule exists:
//   AI agents commonly need the affected row back after a write — to
//   confirm the new id, to surface the updated state to the caller, to
//   chain follow-up queries. Without RETURNING the agent has to either
//   re-query (burning tokens, racing on concurrency, or using stale
//   data) or proceed blind. Most-useful-when the agent's prompt
//   explicitly asked for the new/updated row; that's why this rule
//   defaults to OFF.
//
// Why default OFF:
//   The SDK has no access to intent, so we cannot tell whether a
//   given write was "I want the row back" vs. "fire-and-forget log
//   append." Default-on would generate a sea of `info` catches on
//   every legitimate write. Customers who do want this signal opt
//   in explicitly:
//
//     analyze(sql, {
//       rules: { 'sql-014': { enabled: true } }
//     })
//
//   or:
//
//     runRules(ast, [...RULES, SQL_014])
//
// Multi-statement scripts: fires on the FIRST RETURNING-less write
// the rule encounters. Same contract as SQL-003.
//
// UPSERT (INSERT ... ON CONFLICT DO UPDATE):
//   We check the outer InsertStmt's returningList. If it's missing,
//   we fire — the agent still needs RETURNING on the outer statement
//   to read back what got inserted or what got updated by the conflict
//   action. The conflict action's own RETURNING (rare) is not part of
//   this rule's check.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface RangeVarLike {
  readonly schemaname?: string;
  readonly relname?: string;
}

interface MissingReturning {
  readonly stmtType: 'INSERT' | 'UPDATE' | 'DELETE';
  readonly tableName: string;
}

export const SQL_014: Rule = (ast) => {
  let target: MissingReturning | null = null;

  astWalk(ast, (node) => {
    if (target) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;

    if ('InsertStmt' in obj) {
      const stmt = obj['InsertStmt'] as Record<string, unknown>;
      if (lacksReturning(stmt)) {
        target = {
          stmtType: 'INSERT',
          tableName: extractRelationName(stmt['relation']),
        };
        return 'stop';
      }
      return undefined;
    }

    if ('UpdateStmt' in obj) {
      const stmt = obj['UpdateStmt'] as Record<string, unknown>;
      if (lacksReturning(stmt)) {
        target = {
          stmtType: 'UPDATE',
          tableName: extractRelationName(stmt['relation']),
        };
        return 'stop';
      }
      return undefined;
    }

    if ('DeleteStmt' in obj) {
      const stmt = obj['DeleteStmt'] as Record<string, unknown>;
      if (lacksReturning(stmt)) {
        target = {
          stmtType: 'DELETE',
          tableName: extractRelationName(stmt['relation']),
        };
        return 'stop';
      }
      return undefined;
    }

    return undefined;
  });

  if (!target) return null;
  const t: MissingReturning = target;

  const verb = t.stmtType.toLowerCase();
  const result: Catch = {
    code: 'SQL-014',
    title: `${t.stmtType} without RETURNING`,
    severity: 'info',
    confidence: 50,
    detail:
      `${t.stmtType} on \`${t.tableName}\` does not include a RETURNING ` +
      `clause. If your agent's plan needs the affected row back — to ` +
      `confirm the new id, surface state to the caller, or chain a ` +
      `follow-up query — without RETURNING the agent has to re-query ` +
      `or proceed blind. This rule is opt-in because not every ` +
      `${verb} needs RETURNING; enable it when the agent's prompts ` +
      `routinely ask "and tell me the affected row."`,
    fix:
      `Add a RETURNING clause that names the columns you'll read back, ` +
      `e.g. \`${t.stmtType} ... RETURNING id, updated_at\`. Postgres ` +
      `executes RETURNING in the same transaction so there's no ` +
      `additional round-trip cost.`,
    threatCategories: ['integrity'],
  };
  return result;
};

/**
 * "Lacks returning" is true when returningList is undefined, null, or
 * an empty array. Any non-empty returningList indicates the agent did
 * include RETURNING.
 */
function lacksReturning(stmt: Record<string, unknown>): boolean {
  const rl = stmt['returningList'];
  if (rl === undefined || rl === null) return true;
  if (Array.isArray(rl) && rl.length === 0) return true;
  return false;
}

function extractRelationName(relation: unknown): string {
  if (!relation || typeof relation !== 'object') return '<unknown>';
  const r = relation as RangeVarLike;
  const schema = typeof r.schemaname === 'string' ? `${r.schemaname}.` : '';
  const name = typeof r.relname === 'string' ? r.relname : '<unknown>';
  return `${schema}${name}`;
}
