import { beforeAll, describe, expect, it } from 'vitest';

import { init } from '@vibeguard-dev/local';

import {
  formatCatches,
  generateSafeSQL,
  type LLMClient,
} from '../src/wrapper.js';

beforeAll(async () => {
  await init();
});

/** Simple deterministic mock LLM that returns from a queue. */
function makeMockLLM(responses: string[]): LLMClient {
  let index = 0;
  return async () => {
    const resp = responses[index];
    index += 1;
    if (resp === undefined) {
      throw new Error('mock LLM ran out of responses');
    }
    return resp;
  };
}

describe('generateSafeSQL', () => {
  it('returns first-attempt SQL when it has no block-severity catches', async () => {
    const llm = makeMockLLM(['SELECT * FROM users WHERE id = 1']);
    const result = await generateSafeSQL('Get user 1', llm);
    expect(result.retries).toBe(0);
    expect(result.sql).toContain('SELECT *');
    expect(result.catches.filter((c) => c.severity === 'block')).toHaveLength(0);
  });

  it('retries when first attempt fires a block-severity catch', async () => {
    // First attempt: cartesian (SQL-001 block). Second attempt: clean.
    const llm = makeMockLLM([
      'SELECT * FROM users, orders',
      'SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id',
    ]);
    const result = await generateSafeSQL('Get user orders', llm);
    expect(result.retries).toBe(1);
    expect(result.sql).toContain('JOIN orders');
  });

  it('passes warn/info catches through without retry', async () => {
    // SQL-005 (NULL comparison) is warn-severity, not block.
    // Default retryOn='block' means we accept warn-only output.
    const llm = makeMockLLM(["SELECT * FROM users WHERE email = NULL"]);
    const result = await generateSafeSQL('Find users with NULL email', llm);
    expect(result.retries).toBe(0);
    expect(result.catches.some((c) => c.code === 'SQL-005')).toBe(true);
    expect(result.catches.every((c) => c.severity !== 'block')).toBe(true);
  });

  it('honors a custom retryOn severity (warn → forces retry on warn-only catches)', async () => {
    const llm = makeMockLLM([
      "SELECT * FROM users WHERE email = NULL", // SQL-005 warn — would normally pass
      'SELECT * FROM users WHERE email IS NULL', // proper IS NULL — clean
    ]);
    const result = await generateSafeSQL('Find users with NULL email', llm, {
      retryOn: 'warn',
    });
    expect(result.retries).toBe(1);
    expect(result.sql).toContain('IS NULL');
  });

  it('throws when the retry budget is exhausted', async () => {
    // Always returns cartesian — never clean.
    const llm = makeMockLLM([
      'SELECT * FROM a, b',
      'SELECT * FROM a, b, c',
      'SELECT * FROM x, y',
      'SELECT * FROM p, q',
    ]);
    await expect(
      generateSafeSQL('Cross-join everything', llm, { maxRetries: 2 }),
    ).rejects.toThrow(/could not produce safe SQL/);
  });

  it('appends LLM feedback in retry prompts', async () => {
    const seenPrompts: string[] = [];
    const responses = [
      'SELECT * FROM a, b', // block
      'SELECT u.id FROM users u', // clean
    ];
    let i = 0;
    const llm: LLMClient = async (prompt) => {
      seenPrompts.push(prompt);
      const r = responses[i];
      i += 1;
      return r ?? '';
    };
    await generateSafeSQL('Get users', llm);
    expect(seenPrompts).toHaveLength(2);
    // Second prompt should mention the catch.
    expect(seenPrompts[1]).toContain('SQL-001');
    expect(seenPrompts[1]).toContain('Cartesian');
  });

  it('handles parse errors with targeted feedback', async () => {
    const seenPrompts: string[] = [];
    const responses = ['SELEKT * FROM users', 'SELECT * FROM users'];
    let i = 0;
    const llm: LLMClient = async (prompt) => {
      seenPrompts.push(prompt);
      const r = responses[i];
      i += 1;
      return r ?? '';
    };
    const result = await generateSafeSQL('Get users', llm);
    expect(result.retries).toBe(1);
    expect(seenPrompts[1]).toContain('could not be parsed as SQL');
  });
});

describe('formatCatches', () => {
  it('produces a numbered list with code/severity/confidence', () => {
    const formatted = formatCatches([
      {
        code: 'SQL-001',
        title: 'Cartesian explosion risk',
        severity: 'block',
        confidence: 95,
        detail: 'two tables in FROM',
        fix: 'add JOIN',
        threatCategories: ['denial-of-service'],
      },
      {
        code: 'SQL-005',
        title: 'NULL comparison',
        severity: 'warn',
        confidence: 95,
        detail: 'col = NULL is UNKNOWN',
        fix: 'use IS NULL',
        threatCategories: ['corruption'],
      },
    ]);
    expect(formatted).toContain('1. [SQL-001 block/95]');
    expect(formatted).toContain('2. [SQL-005 warn/95]');
    expect(formatted).toContain('Fix: add JOIN');
    expect(formatted).toContain('Fix: use IS NULL');
  });
});
