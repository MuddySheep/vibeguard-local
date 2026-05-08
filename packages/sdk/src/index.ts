// Public API for @vibeguard-dev/local.
//
// Surface is small on purpose:
//   - `analyze(sql, options?)` — the one function 99% of consumers use
//   - `init()` — one-time async WASM-parser bootstrap
//   - Type re-exports for typed consumer code
//   - Substrate helpers and `RULES` for advanced consumers building
//     their own static checks on the same primitives
//   - `RULE_REGISTRY` (V1.1+) — registry with metadata for advanced
//     consumers who want to enumerate rules including default-OFF ones
//   - `parseQuery` re-export for advanced consumers who want raw AST
//     access without the rule-registry pass
//
// STABILITY.md commits to keeping this surface stable post-1.0.
// Adding a new top-level export is a minor-version event; removing
// or renaming is major.

import { parseQuery } from './parser.js';
import { runRules } from './run-rules.js';
import { RULE_REGISTRY, RULES } from './rules/index.js';
import type { AnalysisResult, Rule } from './types.js';

/**
 * Optional options for the public `analyze` entry point.
 *
 * - `logger` — passed to the rule runner; per-rule throws are reported
 *   here. Default: `console.error`.
 * - `rules` (V1.1+) — per-rule overrides keyed by catch code (e.g.
 *   `'sql-014'`, case-insensitive). Use to opt in to default-OFF
 *   rules or to disable default-ON rules for a single call. Rules
 *   not mentioned use their `defaultEnabled` setting from
 *   `RULE_REGISTRY`.
 *
 * @example
 *   // Opt in to SQL-014 (default-OFF)
 *   analyze(sql, { rules: { 'sql-014': { enabled: true } } });
 *
 * @example
 *   // Disable SQL-007 for one call
 *   analyze(sql, { rules: { 'sql-007': { enabled: false } } });
 */
export interface AnalyzeOptions {
  readonly logger?: { readonly error: (msg: string, err: unknown) => void };
  readonly rules?: {
    readonly [code: string]: { readonly enabled?: boolean };
  };
}

/**
 * Run static analysis on a SQL string.
 *
 * Synchronous (after a one-time `await init()` at startup; see
 * ARCHITECTURE.md). Throw-safe: returns a structured `AnalysisResult`
 * even on adversarial / malformed / pre-init input — never throws.
 *
 * @param sql - the SQL string to analyze
 * @param options - optional overrides (logger, per-rule enable/disable)
 *
 * @example
 *   import { init, analyze } from '@vibeguard-dev/local';
 *   await init();
 *   const result = analyze('UPDATE users SET email = $1');
 *   for (const c of result.catches) {
 *     console.error(`[${c.code}] ${c.title}: ${c.detail}`);
 *   }
 */
export function analyze(sql: string, options?: AnalyzeOptions): AnalysisResult {
  const parsed = parseQuery(sql);
  if (parsed.error) {
    return { catches: [], parseError: parsed.error };
  }
  const enabledRules = options?.rules
    ? resolveEnabledRules(options.rules)
    : RULES;
  const catches = runRules(parsed.ast, enabledRules, options);
  return { catches };
}

/**
 * Walk RULE_REGISTRY and return the rules that should run, given
 * the user-supplied per-rule overrides.
 *
 * Match is case-insensitive on the catch code: `'sql-014'`, `'SQL-014'`,
 * and `'Sql-014'` all target the same rule. Rules not mentioned in
 * `overrides` use their `defaultEnabled` value.
 */
function resolveEnabledRules(
  overrides: NonNullable<AnalyzeOptions['rules']>,
): readonly Rule[] {
  const overrideMap = new Map<string, boolean>();
  for (const [code, value] of Object.entries(overrides)) {
    if (value?.enabled === undefined) continue;
    overrideMap.set(code.toLowerCase(), value.enabled);
  }

  const out: Rule[] = [];
  for (const entry of RULE_REGISTRY) {
    const override = overrideMap.get(entry.code.toLowerCase());
    const enabled =
      override === true
        ? true
        : override === false
          ? false
          : entry.defaultEnabled;
    if (enabled) out.push(entry.rule);
  }
  return out;
}

// ---------------------------------------------------------------------
// Re-exports for advanced consumers
// ---------------------------------------------------------------------

// Bootstrap (one-time async WASM init):
export { init } from './parser.js';

// Public types:
export type {
  AnalysisResult,
  Catch,
  Fixer,
  ParseError,
  Rule,
  Severity,
  ThreatCategory,
} from './types.js';

// Autofix runner (V1.3+):
export { applyFixes } from './apply-fixes.js';
export type {
  ApplyFixesOptions,
  ApplyFixesResult,
  ApplyFixesRulesOption,
} from './apply-fixes.js';

// Raw parser access (advanced):
export { parseQuery } from './parser.js';
export type { ParseQueryResult } from './parser.js';

// Substrate helpers (for users building their own static checks on the
// same primitives — promised in README and ARCHITECTURE.md):
export { astWalk, AST_WALK_MAX_DEPTH } from './ast-walk.js';
export type { AstVisitor } from './ast-walk.js';
export { extractFromTables } from './extract-tables.js';
export type { FromTable } from './extract-tables.js';
export { extractColumns } from './extract-columns.js';
export type { ColumnRef } from './extract-columns.js';

// Rule runner + registry (for users plugging in their own rules):
export { runRules } from './run-rules.js';
export type { RunRulesOptions } from './run-rules.js';
export { RULES, RULE_REGISTRY } from './rules/index.js';
export type { RuleEntry } from './rules/index.js';
