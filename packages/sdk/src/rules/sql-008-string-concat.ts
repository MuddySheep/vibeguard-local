// SQL-008 — Possible string-concatenation injection.
//
// Severity:    block
// Confidence:  80–90 (param-bearing concat = 90; mixed-shape = 80)
// Threat:      injection
//
// Pattern: a string-concat operator (`||`) is used with at least one
// non-literal operand that's NOT a plain column reference. The
// canonical SQL-injection shape is `'WHERE id = ' || $1 || ' OR ...'`
// — building SQL fragments via interpolation. Even legitimate uses
// (e.g. `$1 || '%'` for a LIKE pattern) mirror the dangerous shape
// closely enough to warrant a block-severity catch.
//
// Detection algorithm:
//   1. Walk every A_Expr with kind=AEXPR_OP, op '||'
//   2. Flatten left-associative concat chains (`a || b || c` becomes
//      ['a', 'b', 'c'] of leaf operands)
//   3. Classify each operand:
//        literal | param | column | array | other
//   4. Suppress if:
//        - all operands are literals (pure literal concat)
//        - any operand is an array literal (Postgres `||` is also
//          array-concat; we don't have schema info to know which
//          overload applies — array operand is a strong "not string-
//          concat" signal)
//        - every operand is column-or-literal (display concat shape;
//          legitimate text-building from row columns)
//   5. Fire if:
//        - any operand is a ParamRef → confidence 90
//          ("dynamic SQL building" — clearest injection shape)
//        - operand mix involves function calls / other shapes →
//          confidence 80 ("borderline; review")
//
// Trade-offs documented in docs/rules/sql-008.md:
//   - LIKE patterns built via `$1 || '%'` fire as false-positive.
//     Cost: rewrite to `$1 || '%'` parameterized differently or
//     suppress in consumer policy. Block-severity is the right
//     defensive default for an injection-class catch.
//   - Array concat across mixed shapes (e.g. `col || ARRAY[1]`)
//     suppresses correctly thanks to the array-operand check.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

type OperandKind = 'literal' | 'param' | 'column' | 'array' | 'other';

interface Hit {
  readonly confidence: number;
  readonly hasParam: boolean;
}

export const SQL_008: Rule = (ast) => {
  let hit: Hit | null = null;

  astWalk(ast, (node) => {
    if (hit) return 'stop';
    if (!isStringConcat(node)) return undefined;

    const operands = flatten(node);
    const kinds = operands.map(classifyOperand);

    // All literals → pure concat, no concern.
    if (kinds.every((k) => k === 'literal')) return 'skip';
    // Any array operand → assume array concat, not string concat.
    if (kinds.some((k) => k === 'array')) return 'skip';
    // Param operand → highest-confidence fire.
    if (kinds.some((k) => k === 'param')) {
      hit = { confidence: 90, hasParam: true };
      return 'stop';
    }
    // All operands are columns or literals → display concat, suppress.
    if (kinds.every((k) => k === 'literal' || k === 'column')) {
      return 'skip';
    }
    // Mix involves function calls or other shapes — fire conservatively.
    hit = { confidence: 80, hasParam: false };
    return 'stop';
  });

  if (!hit) return null;
  const h: Hit = hit;

  const detailLead = h.hasParam
    ? 'A string-concatenation operator (`||`) combines a parameter ' +
      'with other operands. This is the canonical shape of SQL ' +
      'injection — even when the parameter is driver-bound, the ' +
      'concatenation result may be interpreted as SQL text rather ' +
      'than as a single value.'
    : 'A string-concatenation operator (`||`) combines a function ' +
      'result or other non-literal expression with other operands. ' +
      'Building SQL fragments via concatenation is a frequent source ' +
      'of injection vulnerabilities.';

  const result: Catch = {
    code: 'SQL-008',
    title: 'Possible string-concatenation injection',
    severity: 'block',
    confidence: h.confidence,
    detail: `${detailLead} The LLM (or human) almost always meant to use parameterized values instead.`,
    fix:
      'Use parameterized queries: pass user-controlled values as `$1`, ' +
      '`$2`, ... bind parameters that the driver substitutes safely. ' +
      'For LIKE patterns, the safer form is `LIKE $1` where the ' +
      'caller passes `value%`; for dynamic identifier construction, ' +
      'use a vetted whitelist instead of concatenation.',
    threatCategories: ['injection'],
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

function isStringConcat(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (!('A_Expr' in (node as Record<string, unknown>))) return false;
  const a = (node as { A_Expr: Record<string, unknown> }).A_Expr;
  if (a['kind'] !== 'AEXPR_OP') return false;
  return readOperator(a['name']) === '||';
}

function flatten(node: unknown): unknown[] {
  if (!isStringConcat(node)) return [node];
  const a = (node as { A_Expr: { lexpr?: unknown; rexpr?: unknown } })
    .A_Expr;
  return [...flatten(a.lexpr), ...flatten(a.rexpr)];
}

function classifyOperand(node: unknown): OperandKind {
  if (!node || typeof node !== 'object') return 'other';
  const obj = node as Record<string, unknown>;
  if ('A_Const' in obj) return 'literal';
  if ('ParamRef' in obj) return 'param';
  if ('ColumnRef' in obj) return 'column';
  if ('A_ArrayExpr' in obj) return 'array';
  return 'other';
}
