// Claude Code integration: pre-flight SQL safety check with retry-on-block.
//
// Flow:
//   1. Caller asks an LLM for SQL (you supply the LLMClient).
//   2. Wrapper calls `analyze(sql)` from @vibeguard-dev/local.
//   3. If any `block`-severity catch fires, the wrapper formats the
//      catches as structured feedback and re-asks the LLM with that
//      feedback appended.
//   4. Loop until clean or the retry budget is exhausted.
//
// The pattern works for ANY agent that can re-ask its LLM with prior
// feedback — Anthropic API, Anthropic SDK, MCP-bound Claude Code,
// or your own wrapper. The `LLMClient` interface keeps the wrapper
// LLM-agnostic; the README shows how to wire the Anthropic SDK
// behind it.
//
// Default retry budget: 3 attempts. Tune for your latency / cost
// envelope.

import { analyze, type Catch, type Severity } from '@vibeguard-dev/local';

/**
 * Minimum interface the wrapper expects from an LLM client. Any
 * function that takes a prompt and returns SQL satisfies this.
 *
 * Real implementations: bind to Anthropic SDK's `messages.create` and
 * extract the SQL from the response. See README.md for an example.
 */
export type LLMClient = (prompt: string) => Promise<string>;

export interface GenerateOptions {
  /** Maximum retries on block-severity catches. Default: 3. */
  readonly maxRetries?: number;
  /**
   * Severity at-or-above which the wrapper treats the SQL as unsafe
   * and triggers a retry. Default: `'block'`.
   */
  readonly retryOn?: Severity;
}

export interface GenerateResult {
  /** The final SQL produced by the LLM. */
  readonly sql: string;
  /**
   * All catches against the final SQL — including warn/info that
   * didn't trigger a retry but are surfaced for downstream policy.
   */
  readonly catches: readonly Catch[];
  /** Number of retries the wrapper had to ask for. 0 = first attempt clean. */
  readonly retries: number;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, block: 3 };

/**
 * Generate SQL with the given LLM, then pre-flight-check it through
 * @vibeguard-dev/local. Retries up to `maxRetries` times if any catch
 * at-or-above `retryOn` severity fires; feeds catches back to the LLM
 * as structured feedback between attempts.
 *
 * Throws if the retry budget is exhausted before producing safe SQL.
 *
 * @example
 *   import Anthropic from '@anthropic-ai/sdk';
 *   import { init } from '@vibeguard-dev/local';
 *   import { generateSafeSQL } from './wrapper.js';
 *
 *   await init();
 *   const client = new Anthropic();
 *   const result = await generateSafeSQL(
 *     'Update Alice\'s email to alice@new.example',
 *     async (prompt) => {
 *       const resp = await client.messages.create({
 *         model: 'claude-sonnet-4-5',
 *         max_tokens: 1024,
 *         messages: [{ role: 'user', content: prompt }],
 *       });
 *       const block = resp.content.find((b) => b.type === 'text');
 *       if (!block || block.type !== 'text') throw new Error('no text');
 *       return block.text.trim();
 *     },
 *   );
 *   console.log(result.sql);
 */
export async function generateSafeSQL(
  prompt: string,
  llm: LLMClient,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const maxRetries = options.maxRetries ?? 3;
  const retryOn = options.retryOn ?? 'block';
  const retryThreshold = SEVERITY_RANK[retryOn];

  let currentPrompt = prompt;
  let lastSql = '';
  let lastCatches: readonly Catch[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const sql = await llm(currentPrompt);
    lastSql = sql;
    const result = analyze(sql);
    lastCatches = result.catches;

    if (result.parseError) {
      // The LLM produced unparseable text. Feed that back too.
      currentPrompt =
        `${prompt}\n\nThe previous attempt could not be parsed as SQL ` +
        `(\`${result.parseError.message}\`). Return only valid Postgres SQL ` +
        `and nothing else.`;
      continue;
    }

    const blockers = result.catches.filter(
      (c) => SEVERITY_RANK[c.severity] >= retryThreshold,
    );
    if (blockers.length === 0) {
      return { sql, catches: result.catches, retries: attempt };
    }

    if (attempt >= maxRetries) break;

    const feedback = formatCatches(blockers);
    currentPrompt =
      `${prompt}\n\nThe previous attempt was rejected by static safety ` +
      `analysis:\n${feedback}\n\nRegenerate the SQL addressing the issues ` +
      `above. Return only valid Postgres SQL.`;
  }

  throw new Error(
    `generateSafeSQL: LLM could not produce safe SQL within ${maxRetries + 1} ` +
      `attempts. Final SQL: ${lastSql}; final catches: ` +
      `${lastCatches.map((c) => c.code).join(', ')}.`,
  );
}

/**
 * Format catches as a numbered list suitable for LLM feedback. Each
 * line is short and structured so the LLM can act on it without
 * additional context.
 */
export function formatCatches(catches: readonly Catch[]): string {
  return catches
    .map(
      (c, i) =>
        `${i + 1}. [${c.code} ${c.severity}/${c.confidence}] ${c.title}\n` +
        `   ${c.detail}\n` +
        `   Fix: ${c.fix}`,
    )
    .join('\n\n');
}
