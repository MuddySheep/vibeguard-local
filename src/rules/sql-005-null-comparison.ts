// SQL-005 — NULL comparison footgun.
//
// Severity:    warn
// Confidence:  95 (range 90-95; see docs/rules/sql-005.md)
// Threat:      corruption
//
// Pattern:
//   - Any binary operator comparison (`=` or `<>`) where one operand
//     is the NULL literal (libpg-query: `A_Const { isnull: true }`)
//   - Including the parser-normalized form of `!=` (which becomes `<>`)
//
// Why fire: `x = NULL` evaluates to UNKNOWN (treated as false) in
// SQL's three-valued logic. The query silently filters out everything
// the author probably intended to match. The correct form is
// `x IS NULL` (or `IS NOT NULL`), which the AST encodes as a
// `NullTest` node — different shape entirely, never matches this rule.
//
// Suppressions (different AST shapes — these don't fire):
//   - `x IS NULL` / `x IS NOT NULL` → NullTest, not A_Expr
//   - `x IS DISTINCT FROM NULL` → A_Expr with kind=AEXPR_DISTINCT
//     (not AEXPR_OP), so the kind filter excludes it
//
// What deliberately DOES fire (per docs/rules/sql-005.md):
//   - `coalesce(col, '') = NULL` — coalesce wraps the column, but the
//     comparison is still direct-NULL on the right; same footgun
//   - `NULL = x` — operand position doesn't matter
//   - Multiple in same query — fires once, on first match (single-
//     Catch contract per Rule type)

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface AConstLike {
  readonly isnull?: boolean;
}

export const SQL_005: Rule = (ast) => {
  let firstHit: { side: 'left' | 'right' } | null = null;

  astWalk(ast, (node) => {
    if (firstHit) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    if (!('A_Expr' in obj)) return undefined;

    const aexpr = obj['A_Expr'] as Record<string, unknown>;
    if (aexpr['kind'] !== 'AEXPR_OP') return undefined;

    // Operator name. libpg-query stores it as a list of one or more
    // String wrappers; we want the first one's sval.
    const op = readOperatorName(aexpr['name']);
    if (op !== '=' && op !== '<>') return undefined;

    if (isNullLiteral(aexpr['lexpr'])) {
      firstHit = { side: 'left' };
      return 'stop';
    }
    if (isNullLiteral(aexpr['rexpr'])) {
      firstHit = { side: 'right' };
      return 'stop';
    }
    return undefined;
  });

  if (!firstHit) return null;

  const result: Catch = {
    code: 'SQL-005',
    title: 'NULL comparison with `=` / `<>`',
    severity: 'warn',
    confidence: 95,
    detail:
      'A comparison uses `=` or `<>` with the NULL literal. In SQL\'s ' +
      'three-valued logic this expression always evaluates to UNKNOWN ' +
      '(treated as false), so the WHERE / HAVING filter silently ' +
      'returns no matches — even for rows where the column genuinely ' +
      'is NULL. Almost always a bug; the LLM likely meant `IS NULL` / ' +
      '`IS NOT NULL`.',
    fix:
      'Replace `col = NULL` with `col IS NULL` (or `col IS NOT NULL` ' +
      'for the inverse). For NULL-safe equality across two values, ' +
      'use `IS DISTINCT FROM` / `IS NOT DISTINCT FROM`.',
    threatCategories: ['corruption'],
  };
  return result;
};

function readOperatorName(name: unknown): string | null {
  if (!Array.isArray(name) || name.length === 0) return null;
  const first = name[0];
  if (!first || typeof first !== 'object') return null;
  const f = first as { String?: { sval?: string } };
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}

function isNullLiteral(operand: unknown): boolean {
  if (!operand || typeof operand !== 'object') return false;
  const wrap = operand as { A_Const?: AConstLike };
  return wrap.A_Const?.isnull === true;
}
