// SQL-004 — Implicit type coercion in WHERE.
//
// Severity:    warn
// Confidence:  75 (range 75-85; see docs/rules/sql-004.md)
// Threat:      corruption
//
// Pattern (heuristic — column-name-based type inference):
//   Find A_Expr comparisons (kind=AEXPR_OP, op in {=, <, >, <=, >=})
//   where one operand is a bare ColumnRef and the other is a bare
//   A_Const (no TypeCast wrapping). Then:
//     - If column name suggests numeric (suffix `_id` / `_count` /
//       `_amount` / etc.) AND literal is a string → fire
//     - If column name suggests text (suffix `_name` / `_email` /
//       `_url` / etc.) AND literal is integer or float → fire
//     - Otherwise → don't fire (we can't statically prove the column
//       type without schema info)
//
// This catch is the heaviest-heuristic rule in the SDK. Confidence is
// at the LOW end of the SDK range (75) to communicate that consumers
// should expect more false positives here than for other catches.
// Documented prominently in the docs page.
//
// Suppressions:
//   - Explicit cast: `'123'::int` — the operand is wrapped in
//     TypeCast, not a bare A_Const. The rule skips.
//   - Function-result: `WHERE col = to_char(...)` — function call is
//     not an A_Const. Skipped.
//   - Parameterized: `WHERE col = $1` — ParamRef is not A_Const.
//     Skipped (we can't infer the parameter's type).
//   - Same-type comparison: integer column vs integer literal → no
//     classification mismatch → no fire.
//   - Date / timestamp columns vs string literals — out of scope in
//     v1 (most legitimate uses are ISO-shape strings; firing is
//     more wrong than not). Documented limitation.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

type ColumnTypeHint = 'numeric' | 'text' | null;
type LiteralKind = 'string' | 'integer' | 'float' | null;

const NUMERIC_NAMES = new Set([
  'id',
  'count',
  'total',
  'amount',
  'size',
  'age',
  'qty',
  'num',
  'price',
  'rank',
  'index',
  'version',
]);
const NUMERIC_SUFFIXES = [
  '_id',
  '_count',
  '_total',
  '_amount',
  '_size',
  '_age',
  '_qty',
  '_num',
  '_price',
  '_rank',
  '_index',
  '_version',
];

const TEXT_NAMES = new Set([
  'name',
  'email',
  'phone',
  'url',
  'uri',
  'description',
  'title',
  'label',
  'tag',
  'slug',
  'path',
  'comment',
  'message',
]);
const TEXT_SUFFIXES = [
  '_name',
  '_email',
  '_phone',
  '_url',
  '_uri',
  '_text',
  '_description',
  '_title',
  '_label',
  '_tag',
  '_slug',
  '_path',
  '_comment',
  '_message',
];

const COMPARISON_OPS = new Set(['=', '<', '>', '<=', '>=', '<>']);

interface Hit {
  readonly columnName: string;
  readonly columnType: 'numeric' | 'text';
  readonly literalKind: 'string' | 'integer' | 'float';
}

export const SQL_004: Rule = (ast) => {
  let hit: Hit | null = null;

  astWalk(ast, (node) => {
    if (hit) return 'stop';
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    if (!('A_Expr' in obj)) return undefined;

    const aexpr = obj['A_Expr'] as Record<string, unknown>;
    if (aexpr['kind'] !== 'AEXPR_OP') return undefined;

    const op = readOperator(aexpr['name']);
    if (op === null || !COMPARISON_OPS.has(op)) return undefined;

    // Look for ColumnRef + A_Const pair (bare, no TypeCast wrapper).
    const left = aexpr['lexpr'];
    const right = aexpr['rexpr'];
    const pair = findColRefConstPair(left, right);
    if (!pair) return undefined;

    const colHint = classifyColumn(pair.columnName);
    if (colHint === null) return undefined;

    const litKind = classifyLiteral(pair.literal);
    if (litKind === null) return undefined;

    // Mismatch matrix:
    if (colHint === 'numeric' && litKind === 'string') {
      hit = {
        columnName: pair.columnName,
        columnType: 'numeric',
        literalKind: 'string',
      };
      return 'stop';
    }
    if (colHint === 'text' && (litKind === 'integer' || litKind === 'float')) {
      hit = {
        columnName: pair.columnName,
        columnType: 'text',
        literalKind: litKind,
      };
      return 'stop';
    }
    return undefined;
  });

  if (!hit) return null;
  const h: Hit = hit;

  const result: Catch = {
    code: 'SQL-004',
    title: 'Likely implicit type coercion in comparison',
    severity: 'warn',
    confidence: 75,
    detail:
      `Column \`${h.columnName}\` is compared against a ${h.literalKind} ` +
      `literal, but its name strongly suggests a ${h.columnType} type. ` +
      `Postgres will attempt an implicit coercion (often disabling index ` +
      `use), or fail at runtime if the value can't be coerced.`,
    fix:
      'If the column type is what the name suggests, change the literal ' +
      "to match (or use an explicit cast like `'123'::int`). If the " +
      "column actually holds the literal's type, the column name is " +
      'misleading — consider renaming for future readers.',
    threatCategories: ['corruption'],
  };
  return result;
};

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function readOperator(name: unknown): string | null {
  if (!Array.isArray(name) || name.length === 0) return null;
  const first = name[0];
  if (!first || typeof first !== 'object') return null;
  const f = first as { String?: { sval?: string } };
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}

interface ColRefConstPair {
  readonly columnName: string;
  readonly literal: unknown;
}

function findColRefConstPair(
  lexpr: unknown,
  rexpr: unknown,
): ColRefConstPair | null {
  // ColumnRef on the left, bare A_Const on the right.
  const leftCol = readColumnName(lexpr);
  if (leftCol !== null && isBareConst(rexpr)) {
    return { columnName: leftCol, literal: rexpr };
  }
  // ColumnRef on the right, bare A_Const on the left.
  const rightCol = readColumnName(rexpr);
  if (rightCol !== null && isBareConst(lexpr)) {
    return { columnName: rightCol, literal: lexpr };
  }
  return null;
}

function readColumnName(expr: unknown): string | null {
  if (!expr || typeof expr !== 'object') return null;
  if (!('ColumnRef' in (expr as Record<string, unknown>))) return null;
  const cr = (expr as { ColumnRef: { fields?: unknown[] } }).ColumnRef;
  const fields = cr.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  // Last field is the column name (qualifier components precede it).
  const last = fields[fields.length - 1];
  if (!last || typeof last !== 'object') return null;
  const f = last as { String?: { sval?: string }; A_Star?: unknown };
  if (f.A_Star) return null;
  return typeof f.String?.sval === 'string' ? f.String.sval : null;
}

function isBareConst(expr: unknown): boolean {
  if (!expr || typeof expr !== 'object') return false;
  // Reject TypeCast — explicit casts suppress the catch.
  if ('TypeCast' in (expr as Record<string, unknown>)) return false;
  if (!('A_Const' in (expr as Record<string, unknown>))) return false;
  return true;
}

function classifyColumn(name: string): ColumnTypeHint {
  const lower = name.toLowerCase();
  if (NUMERIC_NAMES.has(lower)) return 'numeric';
  if (TEXT_NAMES.has(lower)) return 'text';
  for (const suffix of NUMERIC_SUFFIXES) {
    if (lower.endsWith(suffix)) return 'numeric';
  }
  for (const suffix of TEXT_SUFFIXES) {
    if (lower.endsWith(suffix)) return 'text';
  }
  return null;
}

function classifyLiteral(node: unknown): LiteralKind {
  if (!node || typeof node !== 'object') return null;
  const wrap = node as { A_Const?: Record<string, unknown> };
  const c = wrap.A_Const;
  if (!c) return null;
  if (c['isnull'] === true) return null; // NULL is its own catch (SQL-005)
  if ('sval' in c) return 'string';
  if ('ival' in c) return 'integer';
  if ('fval' in c) return 'float';
  return null;
}
