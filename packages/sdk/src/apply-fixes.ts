// applyFixes — iterate-until-stable autofix runner.
//
// Mirrors ESLint's pattern: each fixer applies AT MOST ONE fix per
// call; the runner re-parses and re-runs the rules after each fix
// and repeats until either no more fixes apply or a hard iteration
// cap is hit.
//
// Safety guards:
//
//   1. After every applied fix, re-parse the result. If parsing fails,
//      the fix is rejected (it corrupted the SQL) and we move on to
//      the next fixable catch. The "current" SQL never advances to a
//      state that doesn't parse.
//
//   2. If a fixer returns `null`, the catch surfaces unchanged in
//      the result's `remainingCatches` and the runner moves on.
//
//   3. If a fixer returns a string identical to the input, the
//      runner treats it as "no progress" and skips it (avoids
//      infinite loops on a buggy fixer that returns the same string
//      forever).
//
//   4. `maxIterations` (default 10) bounds total iterations. Any
//      catch that survives beyond the cap surfaces in
//      `remainingCatches`; `hitIterationLimit` flags this.
//
// Per-rule overrides (via `options.rules`) are respected — disabled
// rules' fixers don't run. Default-OFF rules can be opted-in here
// the same way they can in `analyze()`.

import { parseQuery } from './parser.js';
import { runRules } from './run-rules.js';
import { RULE_REGISTRY } from './rules/index.js';
import type { Catch, Rule } from './types.js';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Per-rule override map, identical in shape to `AnalyzeOptions.rules`.
 */
export interface ApplyFixesRulesOption {
  readonly [code: string]: { readonly enabled?: boolean };
}

export interface ApplyFixesOptions {
  /**
   * Per-rule overrides keyed by catch code (case-insensitive).
   * Same shape as `AnalyzeOptions.rules`.
   */
  readonly rules?: ApplyFixesRulesOption;

  /**
   * Maximum iterations before the runner stops. Default 10. Used to
   * bound runaway loops in case a fixer/rule pair oscillates.
   */
  readonly maxIterations?: number;

  /**
   * Optional logger forwarded to runRules. Default `console.error`.
   */
  readonly logger?: { readonly error: (msg: string, err: unknown) => void };
}

export interface ApplyFixesResult {
  /** Final SQL after all fixes. Equal to the input if no fix applied. */
  readonly sql: string;
  /** True iff the final SQL differs from the input. */
  readonly changed: boolean;
  /** Total fixes applied across all iterations. */
  readonly fixesApplied: number;
  /** Catches that remain after fixing — either unfixable or fail-soft. */
  readonly remainingCatches: readonly Catch[];
  /** True iff iteration stopped at `maxIterations`. */
  readonly hitIterationLimit: boolean;
  /**
   * Codes of rules whose fixers were actually invoked at least once
   * (regardless of whether the fix landed). Useful for diff summaries
   * in CLI output.
   */
  readonly fixersInvoked: readonly string[];
}

/**
 * Apply autofixes iteratively until stable.
 *
 * @example
 *   import { applyFixes, init } from '@vibeguard-dev/local';
 *   await init();
 *   const result = applyFixes('SELECT * FROM users WHERE x = NULL');
 *   if (result.changed) {
 *     fs.writeFileSync('q.sql', result.sql);
 *   }
 */
export function applyFixes(
  sql: string,
  options: ApplyFixesOptions = {},
): ApplyFixesResult {
  const max = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // Build the enabled-rule set the same way analyze() does.
  const overrides = options.rules ?? {};
  const overrideMap = new Map<string, boolean>();
  for (const [code, value] of Object.entries(overrides)) {
    if (value?.enabled === undefined) continue;
    overrideMap.set(code.toLowerCase(), value.enabled);
  }
  const enabledEntries = RULE_REGISTRY.filter((entry) => {
    const o = overrideMap.get(entry.code.toLowerCase());
    if (o === true) return true;
    if (o === false) return false;
    return entry.defaultEnabled;
  });
  const enabledRules: readonly Rule[] = enabledEntries.map((e) => e.rule);

  const fixersInvoked = new Set<string>();
  let current = sql;
  let fixesApplied = 0;

  for (let iter = 0; iter < max; iter++) {
    const parsed = parseQuery(current);
    if (parsed.error) {
      // Should never happen — we only ever advance `current` to a
      // state that parses. Defensive return.
      return {
        sql: current,
        changed: current !== sql,
        fixesApplied,
        remainingCatches: [],
        hitIterationLimit: false,
        fixersInvoked: Array.from(fixersInvoked),
      };
    }

    const catches = runRules(parsed.ast, enabledRules, options);

    let appliedFix = false;
    for (const c of catches) {
      const entry = enabledEntries.find((e) => e.code === c.code);
      if (!entry?.fixer) continue;

      let next: string | null;
      try {
        next = entry.fixer.fix(parsed.ast, current);
        fixersInvoked.add(entry.code);
      } catch {
        // A throwing fixer doesn't bring down the run.
        continue;
      }
      if (next === null || next === current) continue;

      // Verify the fix produces parseable SQL before adopting it.
      const verify = parseQuery(next);
      if (verify.error) {
        // Bad fix — try the next catch in this iteration.
        continue;
      }

      current = next;
      fixesApplied++;
      appliedFix = true;
      break; // re-loop to re-run rules against the modified SQL
    }

    if (!appliedFix) {
      // Stable — every remaining catch is unfixable (or has no fixer).
      return {
        sql: current,
        changed: current !== sql,
        fixesApplied,
        remainingCatches: catches,
        hitIterationLimit: false,
        fixersInvoked: Array.from(fixersInvoked),
      };
    }
  }

  // Hit the iteration cap. Compute the catches that remain.
  const finalParsed = parseQuery(current);
  const remaining = finalParsed.error
    ? []
    : runRules(finalParsed.ast, enabledRules, options);
  return {
    sql: current,
    changed: current !== sql,
    fixesApplied,
    remainingCatches: remaining,
    hitIterationLimit: true,
    fixersInvoked: Array.from(fixersInvoked),
  };
}
