// SQL-012 — Recursive CTE without obvious termination.
//
// Severity:    block
// Confidence:  85 (range 80-95; see docs/rules/sql-012.md)
// Threat:      denial-of-service
//
// Pattern:
//   - A `WithClause` has `recursive: true`
//   - One of its CommonTableExpr CTEs has a SelectStmt body whose
//     recursive arm self-references the CTE
//   - The recursive arm's whereClause does NOT contain a comparison
//     against a numeric constant (the heuristic for "termination
//     condition")
//
// Why fire: a recursive CTE without termination iterates unboundedly
// until Postgres exhausts memory. This is a denial-of-service shape.
//
// The heuristic is best-effort:
//   - We can prove "no constant-bounded predicate exists" but we can't
//     prove "this WILL terminate" (halting-problem-equivalent). So
//     we accept some false-positives in exchange for catching the
//     obvious unbounded shapes. Block-severity matches the asymmetric
//     cost: false-positive forces an explicit depth limit (harmless);
//     false-negative could DoS production.
//   - Missed cases: recursion bounded via predicate against another
//     column, JOIN, or non-trivial expression. Documented limitations.
//
// Suppressions:
//   - Non-recursive CTEs (`WITH x AS (...)`) — withClause.recursive is
//     false / undefined
//   - WITH RECURSIVE declared but the CTE body has no self-reference
//     (rare; user wrote RECURSIVE but didn't use it)
//   - Recursive arm has a comparison-against-literal predicate

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface CTEWrapper {
  readonly CommonTableExpr?: {
    readonly ctename?: string;
    readonly ctequery?: unknown;
  };
}

const BOUNDING_OPS = new Set<string>(['<', '<=', '>', '>=', '=', '<>']);

export const SQL_012: Rule = (ast) => {
  let hit: { cteName: string } | null = null;

  astWalk(ast, (node, key) => {
    if (hit) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;

    // `withClause` is NOT wrapped in `{WithClause: {...}}` — it's a
    // direct property of SelectStmt with shape `{recursive, ctes}`.
    // Detect by parent property key plus the characteristic fields
    // (defense-in-depth — keys can be reused).
    if (key !== 'withClause') return undefined;
    if (obj['recursive'] !== true) return undefined;
    if (!Array.isArray(obj['ctes'])) return undefined;

    const ctes = obj['ctes'] as readonly CTEWrapper[];
    for (const cteWrap of ctes) {
      if (!cteWrap || typeof cteWrap !== 'object') continue;
      const cte = cteWrap.CommonTableExpr;
      if (!cte) continue;
      const cteName = cte.ctename;
      if (typeof cteName !== 'string') continue;

      const body = cte.ctequery;
      if (!body || typeof body !== 'object') continue;
      const sel = (body as { SelectStmt?: Record<string, unknown> })
        .SelectStmt;
      if (!sel) continue;

      // Recursive shape uses SET UNION (op:SETOP_UNION) with larg/rarg.
      if (sel['op'] !== 'SETOP_UNION') continue;
      const rarg = sel['rarg'];
      if (!rarg || typeof rarg !== 'object') continue;

      // Verify self-reference in rarg.fromClause.
      const recursiveArm = rarg as Record<string, unknown>;
      if (!hasSelfReference(recursiveArm['fromClause'], cteName)) continue;

      // Check for a bounding predicate in rarg.whereClause.
      const where = recursiveArm['whereClause'];
      if (where && hasBoundingPredicate(where)) continue;

      hit = { cteName };
      return 'stop';
    }
    return undefined;
  });

  if (!hit) return null;
  const h: { cteName: string } = hit;

  const result: Catch = {
    code: 'SQL-012',
    title: 'Recursive CTE without obvious termination',
    severity: 'block',
    confidence: 85,
    detail:
      `The recursive CTE \`${h.cteName}\` has a self-referencing ` +
      `recursive arm with no comparison against a numeric constant ` +
      `to bound the recursion. Without an explicit termination ` +
      `condition, Postgres iterates the recursion until it exhausts ` +
      `memory — a denial-of-service shape on production data.`,
    fix:
      `Add a depth-bounding predicate to the recursive arm's WHERE ` +
      `clause (e.g. \`WHERE n < 100\` or \`WHERE depth < 10\`). If ` +
      `the recursion is genuinely bounded by data shape rather than a ` +
      `constant (e.g. tree walks where the data structure has finite ` +
      `depth), add an explicit depth-counter column anyway — production ` +
      `data shape changes, and a depth limit is cheap insurance.`,
    threatCategories: ['denial-of-service'],
  };
  return result;
};

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function hasSelfReference(fromClause: unknown, cteName: string): boolean {
  if (!fromClause) return false;
  let found = false;
  astWalk(fromClause, (node) => {
    if (found) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    if (!('RangeVar' in (node as Record<string, unknown>))) return undefined;
    const rv = (node as { RangeVar: { relname?: string } }).RangeVar;
    if (rv.relname === cteName) {
      found = true;
      return 'stop';
    }
    return undefined;
  });
  return found;
}

function hasBoundingPredicate(whereClause: unknown): boolean {
  let found = false;
  astWalk(whereClause, (node) => {
    if (found) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    if (!('A_Expr' in (node as Record<string, unknown>))) return undefined;
    const a = (node as { A_Expr: Record<string, unknown> }).A_Expr;
    if (a['kind'] !== 'AEXPR_OP') return undefined;
    const op = readOperatorName(a['name']);
    if (op === null || !BOUNDING_OPS.has(op)) return undefined;
    // At least one operand must be a numeric A_Const literal.
    if (
      isNumericLiteral(a['lexpr']) ||
      isNumericLiteral(a['rexpr'])
    ) {
      found = true;
      return 'stop';
    }
    return undefined;
  });
  return found;
}

function readOperatorName(name: unknown): string | null {
  if (!Array.isArray(name) || name.length === 0) return null;
  const first = name[0];
  if (!first || typeof first !== 'object') return null;
  const f = first as { String?: { sval?: string } };
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}

function isNumericLiteral(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (!('A_Const' in (node as Record<string, unknown>))) return false;
  const c = (node as { A_Const: Record<string, unknown> }).A_Const;
  if (c['isnull'] === true) return false;
  return 'ival' in c || 'fval' in c;
}
