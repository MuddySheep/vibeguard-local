// SQL-008 — Possible string-concatenation injection.
//
// Two-tier detection (v1.6+):
//
//   CASE 1 — runtime-injection shape   (severity: warn, confidence: 85)
//     Concat (`||`) where at least one operand is NOT a literal A_Const
//     and NOT an array literal. Param refs, column refs concatenated
//     with non-literals, function-call results, sub-selects, etc. all
//     qualify. This is the actually-exploitable shape — the value
//     placed into the SQL fragment is not constant-foldable, so an
//     attacker-controlled value can change the meaning of the query.
//
//   CASE 2 — pure-literal injection-payload shape   (severity: info, confidence: 75)
//     Concat (`||`) where every operand is a literal A_Const, AND at
//     least one literal contains an injection-payload signature
//     (`OR`/`UNION`/`DROP`/`TRUNCATE`/`DELETE`/`EXEC`/`EXECUTE`
//     keywords, comment markers, statement terminators followed by
//     identifiers, `1=1` tautology, `''=''` quote-evasion). The query
//     itself is constant-folded and harmless at runtime, but the SHAPE
//     is the unmistakable footprint of code an LLM (or human) writes
//     when they're authoring an injection vector. Surface it at info
//     so the reviewer can investigate without crying wolf.
//
//   CASE 3 — pure-literal benign concat   (suppressed)
//     All operands literal, no payload signature in any literal.
//     Examples: `'a' || 'b'`, `'hello ' || ' world'`,
//     `'first' || ' ' || 'last'`. Constant-folded, no injection
//     vector, no injection-shape footprint — silent.
//
//   Array operands (`A_ArrayExpr`) → suppressed at every tier.
//   Postgres `||` is also array-concat; without schema info we can't
//   tell which overload applies, and array operands are a strong
//   "not string concat" signal.
//
//   Display concat (`first_name || ' ' || last_name` — all column-
//   or-literal with no payload signature) → suppressed. Falls through
//   CASE 1 (no non-literal operand qualifies because column refs are
//   the legitimate display-concat shape) into CASE 2 (mixed not all-
//   literal so payload check doesn't apply) and emits nothing.
//
// Stability:
//   Every query that fired SQL-008 in v1.5 still fires in v1.6.
//   Confidence and severity for the v1.5 param-bearing fire shifted
//   from (block, 90) to (warn, 85) per consumer feedback that block
//   was too aggressive given the LIKE-pattern false-positive surface.
//   Per STABILITY.md, severity changes on existing catches require
//   a minor-version bump and CHANGELOG entry — both present in 1.6.0.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule, Severity } from '../types.js';

type OperandKind = 'literal' | 'param' | 'column' | 'array' | 'other';

interface Hit {
  readonly tier: 'runtime' | 'payload-shape';
  readonly confidence: number;
  readonly severity: Severity;
}

// Injection-payload signatures we look for INSIDE pure-literal concat
// chains. These are the obvious shapes — refine if false-positive
// reports come in. Word-boundaries on keywords prevent matching e.g.
// "DROPDOWN" or "EXECUTOR".
const PAYLOAD_SIGNATURE =
  /\b(OR|UNION|DROP|TRUNCATE|DELETE|EXEC|EXECUTE)\b|--|;\s*\w|\b1\s*=\s*1\b|'\s*=\s*'/i;

export const SQL_008: Rule = (ast) => {
  let hit: Hit | null = null;

  astWalk(ast, (node) => {
    if (hit) return 'stop';
    if (!isStringConcat(node)) return undefined;

    const operands = flatten(node);
    const kinds = operands.map(classifyOperand);

    // Array operand → assume array concat, not string concat. Skip.
    if (kinds.some((k) => k === 'array')) return 'skip';

    // CASE 1 — any non-literal, non-column-only operand is the
    // runtime-injection shape. Param OR mixed-with-function-call OR
    // any 'other' kind. Pure column-only display concat falls through
    // (handled in the all-literal-or-column branch below).
    if (kinds.some((k) => k === 'param' || k === 'other')) {
      hit = { tier: 'runtime', confidence: 85, severity: 'warn' };
      return 'stop';
    }

    // All operands are columns/literals. Two sub-cases:
    //   - Pure literal → CASE 2 / CASE 3 distinction by payload regex.
    //   - Mixed column + literal (or all column) → display concat,
    //     suppress regardless of literal contents (a column reference
    //     means the value isn't constant-foldable but it also isn't
    //     attacker-built; it's the row's own data).
    if (kinds.every((k) => k === 'literal')) {
      // Concatenate the literal text and check for payload signature.
      const blob = operands.map(literalText).join(' ');
      if (PAYLOAD_SIGNATURE.test(blob)) {
        hit = {
          tier: 'payload-shape',
          confidence: 75,
          severity: 'info',
        };
        return 'stop';
      }
      // CASE 3 — benign pure-literal concat. Skip.
      return 'skip';
    }

    // Mixed column + literal → display concat. Skip.
    return 'skip';
  });

  if (!hit) return null;
  const h: Hit = hit;

  const detailLead =
    h.tier === 'runtime'
      ? 'A string-concatenation operator (`||`) combines a parameter, ' +
        'function result, or other non-literal expression with other ' +
        'operands. This is the canonical runtime shape of SQL ' +
        'injection — the value placed into the SQL fragment is not ' +
        'constant-foldable, so an attacker-controlled value can ' +
        'change the meaning of the query.'
      : 'A string-concatenation operator (`||`) combines literal ' +
        'strings, and at least one of those literals contains an ' +
        "injection-payload signature (e.g. `OR`, `1=1`, `--`, `;`). " +
        'The query as written is constant-folded by the parser and ' +
        'is not exploitable at runtime, but the shape is the ' +
        'unmistakable footprint of injection-style code authoring — ' +
        'worth a manual review of how the surrounding code came to ' +
        'produce this query.';

  const result: Catch = {
    code: 'SQL-008',
    title: 'Possible string-concatenation injection',
    severity: h.severity,
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

function literalText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const obj = node as { A_Const?: { sval?: { sval?: string } } };
  return obj.A_Const?.sval?.sval ?? '';
}
