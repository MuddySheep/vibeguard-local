import { beforeAll, describe, expect, it, vi } from 'vitest';

import { init } from '@vibeguard-dev/local';

import { withVibeGuard } from '../src/cursor-tool.js';

beforeAll(async () => {
  await init();
});

describe('withVibeGuard', () => {
  it('executes when SQL has no block-severity catches', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [{ id: 1 }] }));
    const guarded = withVibeGuard(exec);
    // Explicit column projection — avoids SQL-015 noise unrelated
    // to what this test asserts (status / exec invocation).
    const r = await guarded('SELECT id, email FROM users WHERE id = 1');
    expect(r.status).toBe('executed');
    expect(exec).toHaveBeenCalledOnce();
    if (r.status === 'executed') {
      expect(r.result.rows[0]?.id).toBe(1);
    }
  });

  it('blocks (does NOT call execute) when SQL fires a block-severity catch', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const guarded = withVibeGuard(exec);
    const r = await guarded("UPDATE users SET email='x'");
    expect(r.status).toBe('blocked');
    expect(exec).not.toHaveBeenCalled();
    if (r.status === 'blocked') {
      expect(r.catches.some((c) => c.code === 'SQL-003')).toBe(true);
    }
  });

  it('returns parse-error status without calling execute', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const guarded = withVibeGuard(exec);
    const r = await guarded('SELEKT * FROM bad');
    expect(r.status).toBe('parse-error');
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes warn/info catches through (default blockOn=block)', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const guarded = withVibeGuard(exec);
    const r = await guarded("SELECT * FROM users WHERE email = NULL");
    expect(r.status).toBe('executed');
    expect(exec).toHaveBeenCalledOnce();
    if (r.status === 'executed') {
      expect(r.catches.some((c) => c.code === 'SQL-005')).toBe(true);
    }
  });

  it('honors blockOn=warn to also block on warn-severity', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const guarded = withVibeGuard(exec, { blockOn: 'warn' });
    const r = await guarded("SELECT * FROM users WHERE email = NULL");
    expect(r.status).toBe('blocked');
    expect(exec).not.toHaveBeenCalled();
  });

  it('honors onBlock=execute-with-warning to run despite catches', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const guarded = withVibeGuard(exec, { onBlock: 'execute-with-warning' });
    const r = await guarded("UPDATE users SET email='x'");
    // Block-severity catch fires, but onBlock=execute-with-warning runs anyway.
    expect(r.status).toBe('executed');
    expect(exec).toHaveBeenCalledOnce();
    if (r.status === 'executed') {
      expect(r.catches.some((c) => c.code === 'SQL-003')).toBe(true);
    }
  });

  it('logs through the supplied logger on block', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const logger = vi.fn();
    const guarded = withVibeGuard(exec, { logger });
    await guarded("UPDATE users SET email='x'");
    expect(logger).toHaveBeenCalledOnce();
    expect(logger.mock.calls[0]?.[0]).toBe('blocked');
  });

  it('does not log on non-blocking catches', async () => {
    const exec = vi.fn(async (_sql: string) => ({ rows: [] }));
    const logger = vi.fn();
    const guarded = withVibeGuard(exec, { logger });
    await guarded('SELECT id, email FROM users WHERE id = 1');
    expect(logger).not.toHaveBeenCalled();
  });

  it('passes the SQL string through verbatim to execute', async () => {
    let captured = '';
    const exec = async (sql: string) => {
      captured = sql;
      return { rows: [] };
    };
    const guarded = withVibeGuard(exec);
    await guarded('SELECT 1');
    expect(captured).toBe('SELECT 1');
  });

  it('propagates execute-thrown errors', async () => {
    const exec = async (_sql: string) => {
      throw new Error('connection refused');
    };
    const guarded = withVibeGuard(exec);
    await expect(guarded('SELECT 1')).rejects.toThrow('connection refused');
  });
});
