// SQL-006 — OFFSET without ORDER BY.
//
// Severity:    warn
// Confidence:  90 (range 85-95; see docs/rules/sql-006.md)
// Threat:      integrity
//
// Pattern:
//   - SelectStmt has a non-zero, non-NULL `limitOffset` clause
//   - SelectStmt has no `sortClause` (no ORDER BY)
//
// Why fire: in PostgreSQL, the order of returned rows is undefined
// without an explicit ORDER BY. `OFFSET N` skips the first N rows
// of an undefined ordering, so paginated queries silently overlap or
// skip results between pages.
//
// Suppressions (these don't fire):
//   - `OFFSET 0` — defensive code, no offset effect
//   - `OFFSET NULL` — Postgres treats this as no offset
//   - `OFFSET N ORDER BY col` — explicit ordering present
//   - `LIMIT N` without OFFSET — limit-only is a much weaker signal
//     and out of scope for this catch (see docs)
//
// Subquery offsets (e.g. `WITH r AS (SELECT ... OFFSET 100) SELECT *
// FROM r ORDER BY x`) are out of scope in v1 — the rule analyzes only
// the first / outermost SelectStmt.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface AConstLike {
  readonly isnull?: boolean;
  readonly ival?: { readonly ival?: number };
}

export const SQL_006: Rule = (ast) => {
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

  const offset = stmt['limitOffset'];
  if (offset === undefined || offset === null) return null;

  // Suppress on defensive zero offset.
  if (isLiteralZero(offset)) return null;
  // Suppress on NULL offset (Postgres treats as no offset).
  if (isLiteralNull(offset)) return null;

  // Check for ORDER BY.
  const sortClause = stmt['sortClause'];
  if (Array.isArray(sortClause) && sortClause.length > 0) return null;

  const result: Catch = {
    code: 'SQL-006',
    title: 'OFFSET without ORDER BY',
    severity: 'warn',
    confidence: 90,
    detail:
      'The query uses `OFFSET` without `ORDER BY`. Postgres does not ' +
      'guarantee row order without an explicit sort, so `OFFSET N` ' +
      'skips an arbitrary N rows. Pagination built on this pattern ' +
      'silently overlaps or skips results between pages — a bug that ' +
      'often only surfaces under load or after data growth.',
    fix:
      'Add an `ORDER BY` clause that produces a deterministic ordering ' +
      '(usually a unique key like `id` or `(created_at, id)`). If you ' +
      'genuinely want to skip an arbitrary subset of rows, the OFFSET ' +
      'is misleading — describe the intent in a comment so future ' +
      'readers know the unordered behavior is intentional.',
    threatCategories: ['integrity'],
  };
  return result;
};

function isLiteralZero(operand: unknown): boolean {
  if (!operand || typeof operand !== 'object') return false;
  const wrap = operand as { A_Const?: AConstLike };
  const c = wrap.A_Const;
  if (!c) return false;
  if (c.isnull) return false; // NULL handled separately
  // libpg-query encodes integer 0 as either:
  //   - ival absent entirely, or
  //   - ival.ival absent (default-zero protobuf encoding), or
  //   - ival.ival === 0 (rare; usually elided)
  // So presence of `ival` field plus absent / zero inner means 0.
  if (c.ival !== undefined) {
    const inner = c.ival.ival;
    return inner === undefined || inner === 0;
  }
  return false;
}

function isLiteralNull(operand: unknown): boolean {
  if (!operand || typeof operand !== 'object') return false;
  const wrap = operand as { A_Const?: AConstLike };
  return wrap.A_Const?.isnull === true;
}
