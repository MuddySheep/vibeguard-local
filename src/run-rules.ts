// Rule registry runner with per-rule throw-safety.
//
// Each rule is a pure `(ast) => Catch | null` function. A rule that
// throws — whether from a libpg-query AST shape it didn't anticipate,
// a logic bug, or adversarial input — must NOT take down the registry
// pass. We wrap every rule call in try/catch and treat a throw as
// "did not fire" for that rule, preserving the catches contributed by
// the other rules.
//
// Per-rule errors are surfaced via an injected logger (via
// `RunRulesOptions.logger.error`) so consumers can wire them into
// their own logging pipeline. Default behavior: log to `console.error`.
//
// We deliberately do NOT bake in retries, fallback rules, or rule
// priority — keeping the runner small and predictable. Rules execute
// in registry order; output is returned in registry order.

import type { Catch, Rule } from './types.js';

/**
 * Optional behavior overrides for `runRules`.
 */
export interface RunRulesOptions {
  /**
   * Logger for per-rule throw events. Receives a human-readable
   * message and the original error value. Defaults to `console.error`.
   *
   * The logger is never invoked for normal rule output — only for
   * exceptions that the runner caught.
   */
  readonly logger?: { readonly error: (msg: string, err: unknown) => void };
}

/**
 * Execute every rule against the AST and collect non-null catches.
 *
 * Throw-safety: if any rule throws, the runner logs (via the supplied
 * or default logger) and treats the rule as "did not fire". Other
 * rules continue to run.
 *
 * Output order: same as registry order. Rules that return null are
 * not represented in the output.
 *
 * @param ast - the parsed AST from `parseQuery`
 * @param rules - registry of rules; typically the SDK's `RULES`
 *                constant, but consumers can pass a subset for
 *                targeted analysis
 * @param options - optional logger override
 */
export function runRules(
  ast: unknown,
  rules: readonly Rule[],
  options?: RunRulesOptions,
): Catch[] {
  const out: Catch[] = [];
  const log =
    options?.logger?.error ??
    ((msg: string, err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(msg, err);
    });

  for (const rule of rules) {
    let result: Catch | null;
    try {
      result = rule(ast);
    } catch (err) {
      log('[vibeguard-local] rule threw and was skipped', err);
      continue;
    }
    if (result !== null) {
      out.push(result);
    }
  }

  return out;
}
