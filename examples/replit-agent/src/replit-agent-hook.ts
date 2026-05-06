// Replit Agent pre-execute hook for VibeGuard SQL safety.
//
// Pattern: a synchronous-friendly hook the Replit Agent (or any
// agent runtime that owns its own retry / feedback loop) calls
// BEFORE executing each LLM-emitted SQL statement. The hook returns
// `{allowed, sql, catches, feedback}` — `allowed` is a boolean the
// runtime branches on, `feedback` is a pre-formatted string the
// runtime can pass back to its own LLM as part of the next-attempt
// prompt.
//
// Distinct from STORY 4.2 (Claude Code) and STORY 4.3 (Cursor):
//   Claude Code wraps the LLM call directly with its OWN retry loop.
//   Cursor wraps the EXECUTE function; runtime acts on the result.
//   Replit Agent: hook returns advisory data; runtime owns the loop.
//
// The hook is fully synchronous (after `await init()` once at
// startup), which makes it cheap to call inside any agent's
// pre-execute path without restructuring the agent's own async
// shape.

import { analyze, type Catch, type Severity } from '@vibeguard-dev/local';

export interface HookOptions {
  /**
   * Severity at-or-above which `allowed` becomes false. Default
   * `'block'`. Use `'warn'` if your agent should also handle warn-
   * severity catches as a retry signal.
   */
  readonly blockOn?: Severity;
  /**
   * Cap on the formatted feedback string length (characters). Long
   * feedback can blow LLM context budgets. Default 2048 — enough
   * for a couple of catches with full detail, truncated with `...`
   * if longer. 0 disables truncation.
   */
  readonly maxFeedbackChars?: number;
}

export interface HookResult {
  /** Whether the SQL passed pre-flight. False on parse error or block-severity catch. */
  readonly allowed: boolean;
  /** The SQL the hook was called with, returned verbatim. */
  readonly sql: string;
  /**
   * All catches the SDK fired against the SQL — including warn /
   * info catches that didn't trigger `allowed = false`. The runtime
   * can surface these as advisories regardless of allowed status.
   */
  readonly catches: readonly Catch[];
  /**
   * Pre-formatted, LLM-friendly feedback string. Empty when no
   * catches fired and SQL parsed cleanly. On parse error, contains
   * the parser's error message. On catches, a numbered list of
   * `[code severity/confidence] title — detail / Fix: fix`.
   */
  readonly feedback: string;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, block: 3 };

/**
 * Build a stateful pre-execute hook. Capture options once at
 * startup; call the returned hook on every SQL statement.
 *
 * @example
 *   import { init } from '@vibeguard-dev/local';
 *   import { createVibeGuardHook } from './replit-agent-hook.js';
 *
 *   await init();
 *   const safetyCheck = createVibeGuardHook({ blockOn: 'block' });
 *
 *   // Inside the agent's database-tool execute path:
 *   const safe = safetyCheck(sql);
 *   if (!safe.allowed) {
 *     // Send safe.feedback back to the LLM as next-attempt context
 *     return retryWithFeedback(safe.feedback);
 *   }
 *   return executeAgainstDatabase(safe.sql);
 */
export function createVibeGuardHook(options: HookOptions = {}) {
  const blockOn = options.blockOn ?? 'block';
  const blockThreshold = SEVERITY_RANK[blockOn];
  const maxFeedback = options.maxFeedbackChars ?? 2048;

  return function hook(sql: string): HookResult {
    const result = analyze(sql);

    if (result.parseError) {
      return {
        allowed: false,
        sql,
        catches: [],
        feedback: `Parse error: ${result.parseError.message}`,
      };
    }

    const blockers = result.catches.filter(
      (c) => SEVERITY_RANK[c.severity] >= blockThreshold,
    );
    const allowed = blockers.length === 0;
    const feedback = formatFeedback(result.catches, maxFeedback);

    return {
      allowed,
      sql,
      catches: result.catches,
      feedback,
    };
  };
}

/**
 * Format catches into a multi-line, numbered-list feedback string.
 * Truncates to `maxChars` characters with a `...` suffix when over.
 *
 * Empty catches → `''` (caller can branch on this directly).
 */
export function formatFeedback(
  catches: readonly Catch[],
  maxChars: number,
): string {
  if (catches.length === 0) return '';
  const lines = catches.map(
    (c, i) =>
      `${i + 1}. [${c.code} ${c.severity}/${c.confidence}] ${c.title}\n` +
      `   ${c.detail}\n` +
      `   Fix: ${c.fix}`,
  );
  const out = lines.join('\n\n');
  if (maxChars > 0 && out.length > maxChars) {
    return `${out.slice(0, maxChars - 3)}...`;
  }
  return out;
}
