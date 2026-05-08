// Cursor integration: pre-flight SQL execution wrapper.
//
// Pattern: wrap any SQL-executing function with a guard that runs
// `analyze(sql)` first and filters out block-severity catches. If
// catches fire above the configured threshold, the guard returns
// `{ status: 'blocked', catches }` WITHOUT invoking the execute
// function. Cursor's agent flow then decides whether to retry the
// generation step, surface the catches to the user, or escalate.
//
// This is the "guard middleware" pattern — distinct from the
// Claude Code "retry-on-block" pattern (which controls the
// GENERATION step). They compose: a Cursor-style guard around the
// SQL executor protects the database; a Claude-Code-style retry
// around the LLM call drives self-correction. Real systems use both.

import { analyze, type Catch, type Severity } from '@vibeguard-dev/local';

/**
 * Action when a catch at-or-above the block threshold fires. The
 * default is `'block'` (don't execute, return blocked status).
 */
export type BlockBehavior = 'block' | 'execute-with-warning';

export interface WithVibeGuardOptions {
  /**
   * Severity at-or-above which the wrapper treats the SQL as unsafe.
   * Default: `'block'`. Use `'warn'` to also block warn-severity.
   */
  readonly blockOn?: Severity;
  /**
   * What to do when a catch matches the block threshold. Default:
   * `'block'`. `'execute-with-warning'` runs anyway and surfaces the
   * catches in the result — useful when the agent has its own
   * fallback policy.
   */
  readonly onBlock?: BlockBehavior;
  /**
   * Logger for catch surfacing. Defaults to `console.warn`. Pass
   * `() => {}` to suppress.
   */
  readonly logger?: (msg: string, catches: readonly Catch[]) => void;
}

/**
 * Result of running the guarded execute function. Always returns
 * the catches that fired (including warn / info even when not
 * blocking) so callers can surface them in their UI / logs.
 */
export type ExecutionResult<T> =
  | {
      readonly status: 'executed';
      readonly catches: readonly Catch[];
      readonly result: T;
    }
  | {
      readonly status: 'blocked';
      readonly catches: readonly Catch[];
    }
  | {
      readonly status: 'parse-error';
      readonly message: string;
    };

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, block: 3 };

/**
 * Wrap a SQL-executing function with a VibeGuard pre-flight check.
 *
 * @example
 *   import { init } from '@vibeguard-dev/local';
 *   import { withVibeGuard } from './cursor-tool.js';
 *
 *   await init();
 *   const safeQuery = withVibeGuard(async (sql) => {
 *     return await pg.query(sql);
 *   });
 *
 *   const r = await safeQuery('SELECT * FROM users WHERE id = $1');
 *   if (r.status === 'blocked') {
 *     console.error('Blocked by:', r.catches.map((c) => c.code).join(', '));
 *   } else if (r.status === 'executed') {
 *     return r.result;
 *   }
 */
export function withVibeGuard<T>(
  execute: (sql: string) => Promise<T>,
  options: WithVibeGuardOptions = {},
): (sql: string) => Promise<ExecutionResult<T>> {
  const blockOn = options.blockOn ?? 'block';
  const onBlock = options.onBlock ?? 'block';
  const logger =
    options.logger ??
    ((msg: string, catches: readonly Catch[]) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[vibeguard] ${msg}: ${catches.map((c) => c.code).join(', ')}`,
      );
    });
  const blockThreshold = SEVERITY_RANK[blockOn];

  return async function guarded(sql: string): Promise<ExecutionResult<T>> {
    const analysis = analyze(sql);

    if (analysis.parseError) {
      return {
        status: 'parse-error',
        message: analysis.parseError.message,
      };
    }

    const blockers = analysis.catches.filter(
      (c) => SEVERITY_RANK[c.severity] >= blockThreshold,
    );

    if (blockers.length > 0 && onBlock === 'block') {
      logger('blocked', blockers);
      return { status: 'blocked', catches: analysis.catches };
    }

    if (blockers.length > 0 && onBlock === 'execute-with-warning') {
      logger('execute-with-warning', blockers);
    }

    const result = await execute(sql);
    return { status: 'executed', catches: analysis.catches, result };
  };
}
