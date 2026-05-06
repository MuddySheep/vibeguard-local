// Public API for @vibeguard-dev/local.
//
// Surface is small on purpose:
//   - `analyze(sql, options?)` — the one function 99% of consumers use
//   - `init()` — one-time async WASM-parser bootstrap
//   - Type re-exports for typed consumer code
//   - Substrate helpers and `RULES` for advanced consumers building
//     their own static checks on the same primitives
//   - `parseQuery` re-export for advanced consumers who want raw AST
//     access without the rule-registry pass
//
// STABILITY.md commits to keeping this surface stable post-1.0.
// Adding a new top-level export is a minor-version event; removing
// or renaming is major.

import { parseQuery } from './parser.js';
import { runRules } from './run-rules.js';
import { RULES } from './rules/index.js';
import type { AnalysisResult } from './types.js';

/**
 * Optional options for the public `analyze` entry point.
 *
 * Currently only carries a logger override that's threaded through to
 * the rule runner — used to surface per-rule throw events to the
 * consumer's own logging pipeline. Default: `console.error`.
 */
export interface AnalyzeOptions {
  readonly logger?: { readonly error: (msg: string, err: unknown) => void };
}

/**
 * Run static analysis on a SQL string.
 *
 * Synchronous (after a one-time `await init()` at startup; see
 * ARCHITECTURE.md). Throw-safe: returns a structured `AnalysisResult`
 * even on adversarial / malformed / pre-init input — never throws.
 *
 * @param sql - the SQL string to analyze
 * @param options - optional overrides (logger)
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
  const catches = runRules(parsed.ast, RULES, options);
  return { catches };
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
  ParseError,
  Rule,
  Severity,
  ThreatCategory,
} from './types.js';

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
export { RULES } from './rules/index.js';
