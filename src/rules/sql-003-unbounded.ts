// SQL-003 — Unbounded UPDATE / DELETE statement.
//
// Severity:    block
// Confidence:  99 (UPDATE) / 97 (DELETE) — see docs/rules/sql-003.md
// Threat:      destruction
//
// Pattern:
//   - An UpdateStmt or DeleteStmt has no `whereClause` field set
//   - This means every row in the target table is affected
//
// In the AI-agent context this is virtually always a bug: the LLM
// intended to scope the operation to specific rows but forgot the
// WHERE. Confidence is at the top of the SDK's range because the
// AST signal is unambiguous (whereClause is present-or-absent — no
// heuristic).
//
// Out of scope (documented):
//   - WHERE TRUE / WHERE 1=1 / other tautologies — those have a
//     whereClause node, just trivially true. Detecting them is its
//     own catch (post-1.0).
//   - TRUNCATE — different statement type entirely; never enters this
//     rule's path.
//   - INSERT INTO ... ON CONFLICT DO UPDATE — the ON CONFLICT update
//     is a different AST shape (InsertStmt.onConflictClause); not
//     this catch's territory.
//
// Multi-statement scripts: the rule fires on the FIRST unbounded
// UPDATE / DELETE it encounters. Subsequent unbounded statements in
// the same parse don't generate additional catches in v1 because the
// Rule type contract is `(ast) => Catch | null`. Documented; future
// enhancement is its own story.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface RangeVarLike {
  readonly schemaname?: string;
  readonly relname?: string;
}

interface UnboundedTarget {
  readonly stmtType: 'UPDATE' | 'DELETE';
  readonly tableName: string;
}

export const SQL_003: Rule = (ast) => {
  let target: UnboundedTarget | null = null;

  astWalk(ast, (node) => {
    if (target) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;

    if ('UpdateStmt' in obj) {
      const stmt = obj['UpdateStmt'] as Record<string, unknown>;
      if (stmt['whereClause'] === undefined) {
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
      if (stmt['whereClause'] === undefined) {
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
  const t: UnboundedTarget = target;

  const verb = t.stmtType.toLowerCase();
  const verbAffected = t.stmtType === 'UPDATE' ? 'modified' : 'deleted';
  const result: Catch = {
    code: 'SQL-003',
    title: `Unbounded ${t.stmtType} statement`,
    severity: 'block',
    confidence: t.stmtType === 'UPDATE' ? 99 : 97,
    detail:
      `${t.stmtType} on \`${t.tableName}\` has no WHERE clause. ` +
      `Every row in the table will be ${verbAffected}. This is almost ` +
      `never the intended behavior for an AI-generated query against ` +
      `production data.`,
    fix:
      `Add a WHERE clause that scopes the ${verb} to specific rows. ` +
      `If you genuinely intend to ${verb} every row, ` +
      `${t.stmtType === 'DELETE' ? 'use TRUNCATE or ' : ''}` +
      `run the statement under explicit operator review.`,
    threatCategories: ['destruction'],
  };
  return result;
};

function extractRelationName(relation: unknown): string {
  if (!relation || typeof relation !== 'object') return '<unknown>';
  const r = relation as RangeVarLike;
  const schema = typeof r.schemaname === 'string' ? `${r.schemaname}.` : '';
  const name = typeof r.relname === 'string' ? r.relname : '<unknown>';
  return `${schema}${name}`;
}
