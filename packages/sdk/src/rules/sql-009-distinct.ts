// SQL-009 — DISTINCT without obvious reduction.
//
// Severity:    info
// Confidence:  65 (range 60-75; see docs/rules/sql-009.md)
// Threat:      integrity
//
// Pattern: a SELECT with `DISTINCT *` (or `DISTINCT u.*`) — every
// projection target is a star expansion. The DISTINCT is a no-op
// in most cases (rows are already distinct unless the underlying
// table has dup-row defects), and the LLM may have intended a
// narrower deduplication.
//
// Suppressed:
//   - `SELECT DISTINCT col` (single-column distinct — deliberate)
//   - `SELECT DISTINCT a, b` (multi-column with explicit projection
//     — also deliberate)
//   - `SELECT DISTINCT ON (col) ...` (Postgres-specific; intentional)
//
// AST detail: libpg-query represents plain `DISTINCT` as
// `distinctClause: [{}]` (one element, empty object) and
// `DISTINCT ON (...)` as `distinctClause: [{ColumnRef: {...}}, ...]`.
// We use the empty-object signature to distinguish the two forms.
//
// First info-level catch in the SDK — exercises the severity ladder.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

export const SQL_009: Rule = (ast) => {
  let selectStmt: Record<string, unknown> | null = null;

  astWalk(ast, (node) => {
    if (selectStmt) return 'stop';
    if (node && typeof node === 'object' && 'SelectStmt' in node) {
      selectStmt = (node as { SelectStmt: Record<string, unknown> })
        .SelectStmt;
      return 'stop';
    }
    return undefined;
  });
  if (!selectStmt) return null;
  const stmt: Record<string, unknown> = selectStmt;

  const distinctClause = stmt['distinctClause'];
  if (!Array.isArray(distinctClause) || distinctClause.length === 0) {
    return null;
  }

  // DISTINCT ON (cols) — distinctClause has non-empty entries.
  // Plain DISTINCT — single empty-object entry.
  if (!isPlainDistinct(distinctClause)) return null;

  const targetList = stmt['targetList'];
  if (!Array.isArray(targetList) || targetList.length === 0) {
    return null;
  }

  // Every target must be a star reference for the rule to fire.
  if (!targetList.every(isStarTarget)) return null;

  const result: Catch = {
    code: 'SQL-009',
    title: 'DISTINCT applied to a star projection',
    severity: 'info',
    confidence: 65,
    detail:
      'The query uses `DISTINCT *` (every column from every joined ' +
      'table). DISTINCT in this position rarely reduces row count — it ' +
      'compares full rows, and full-row duplicates are uncommon — so ' +
      'the LLM may have meant to dedupe on a narrower projection ' +
      'instead.',
    fix:
      'Either drop `DISTINCT` if the underlying query already returns ' +
      'unique rows, or specify which columns to dedupe on. For Postgres-' +
      'specific keep-one-per-group behavior, use ' +
      '`SELECT DISTINCT ON (key) ...` with an `ORDER BY` that picks the ' +
      'right row per group.',
    threatCategories: ['integrity'],
  };
  return result;
};

function isPlainDistinct(clause: readonly unknown[]): boolean {
  // Plain DISTINCT: single element that's an empty-keyed object.
  if (clause.length !== 1) return false;
  const first = clause[0];
  if (!first || typeof first !== 'object') return false;
  return Object.keys(first as object).length === 0;
}

function isStarTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  if (!('ResTarget' in (target as Record<string, unknown>))) return false;
  const rt = (target as { ResTarget: { val?: unknown } }).ResTarget;
  const val = rt.val;
  if (!val || typeof val !== 'object') return false;
  if (!('ColumnRef' in (val as Record<string, unknown>))) return false;
  const cr = (val as { ColumnRef: { fields?: unknown[] } }).ColumnRef;
  const fields = cr.fields;
  if (!Array.isArray(fields) || fields.length === 0) return false;
  // Last field must be A_Star (covers both `*` and `t.*` forms).
  const last = fields[fields.length - 1];
  if (!last || typeof last !== 'object') return false;
  return 'A_Star' in (last as Record<string, unknown>);
}
