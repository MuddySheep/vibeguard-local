import { Readable } from 'node:stream';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAnalyze } from '../src/cli/analyze.js';
import { init } from '../src/index.js';

// EPIC-OSS-5 / STORY-5.4 — --stdin input mode.
//
// Verifies the new stdin-reading branch behaves correctly across:
//   - Plain reads (catches surfaced in human / jsonl / reflect formats)
//   - Empty input
//   - Oversized input (>5 MB cap)
//   - Parse errors
//   - Mutual exclusivity with positional globs / --fix / --fix-dry-run
//
// Tests pass `options.stdin = Readable.from([buf])` so they never
// touch process.stdin (vitest's worker model treats it as a TTY).

beforeAll(async () => {
  await init();
});

let stdoutCalls: string[];
let stderrCalls: string[];

beforeEach(async () => {
  stdoutCalls = [];
  stderrCalls = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutCalls.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrCalls.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stdoutText(): string {
  return stdoutCalls.join('');
}
function stderrText(): string {
  return stderrCalls.join('');
}
function stdoutLines(): string[] {
  return stdoutText().split('\n').filter((line) => line.length > 0);
}

function stdinFrom(sql: string): NodeJS.ReadableStream {
  return Readable.from([Buffer.from(sql, 'utf8')]);
}

describe('runAnalyze --stdin — basic reads', () => {
  it('reads SQL from stdin and emits catches via human format', async () => {
    const r = await runAnalyze(
      ['--stdin'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(1);
    expect(r.blockCatches).toBeGreaterThanOrEqual(1);
    expect(r.filesAnalyzed).toBe(1);
    const out = stdoutText();
    expect(out).toContain('SQL-013');
    expect(out).toContain('<stdin>');
    expect(out).toContain('in 1 file');
  });

  it('reads stdin + --format=jsonl, file field is <stdin>', async () => {
    const r = await runAnalyze(
      ['--stdin', '--format=jsonl'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(1);
    const lines = stdoutLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed._schema).toBe('vg-jsonl/1');
      expect(parsed.file).toBe('<stdin>');
    }
  });

  it('reads stdin + --reflect, action includes <stdin>', async () => {
    const r = await runAnalyze(
      ['--stdin', '--reflect'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(1);
    const lines = stdoutLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed._schema).toBe('vg-reflect/0');
      expect(parsed.file).toBe('<stdin>');
      expect(parsed.action).toContain('<stdin>');
      expect(parsed.action).toContain('SQL-013');
    }
  });

  it('reads stdin + --format=ndjson (alias)', async () => {
    const r = await runAnalyze(
      ['--stdin', '--format=ndjson'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(1);
    for (const line of stdoutLines()) {
      const parsed = JSON.parse(line);
      expect(parsed._schema).toBe('vg-jsonl/1');
    }
  });

  it('clean SQL on stdin → exit 0, no block catches', async () => {
    const r = await runAnalyze(
      ['--stdin', '--format=jsonl'],
      { stdin: stdinFrom('SELECT id FROM users WHERE id = 1;\n') },
    );
    expect(r.exitCode).toBe(0);
    expect(r.blockCatches).toBe(0);
    // stdout in jsonl mode is empty when no catches.
    expect(stdoutText()).toBe('');
  });
});

describe('runAnalyze --stdin — edge cases', () => {
  it('empty stdin → zero catches, exit 0', async () => {
    const r = await runAnalyze(
      ['--stdin'],
      { stdin: stdinFrom('') },
    );
    expect(r.exitCode).toBe(0);
    expect(r.totalCatches).toBe(0);
    expect(r.filesAnalyzed).toBe(1);
  });

  it('parse error on stdin → stderr message, no catches', async () => {
    const r = await runAnalyze(
      ['--stdin', '--format=jsonl'],
      { stdin: stdinFrom('SELEKT 1 FROM @\n') },
    );
    // Parse errors are informational; no block catch fired.
    expect(r.exitCode).toBe(0);
    expect(r.totalCatches).toBe(0);
    expect(stderrText()).toContain('parse error');
    expect(stderrText()).toContain('<stdin>');
    expect(stdoutText()).toBe('');
  });

  it('stdin over the 5 MB cap → exit 1 with stderr warning', async () => {
    // 6 MB of 'A' — adversarial size, not real SQL. The size check
    // fires before parse, so contents don't matter.
    const big = 'A'.repeat(6 * 1024 * 1024);
    const r = await runAnalyze(
      ['--stdin'],
      { stdin: stdinFrom(big) },
    );
    expect(r.exitCode).toBe(1);
    expect(r.filesAnalyzed).toBe(0);
    expect(stderrText()).toContain('exceeds cap');
    expect(stderrText()).toContain('<stdin>');
  });
});

describe('runAnalyze --stdin — mutual exclusivity', () => {
  it('--stdin + positional glob → exit 2', async () => {
    const r = await runAnalyze(
      ['--stdin', 'src/**/*.sql'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--stdin and positional file patterns are mutually exclusive');
  });

  it('--stdin + --fix → exit 2', async () => {
    const r = await runAnalyze(
      ['--stdin', '--fix'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--stdin and --fix are mutually exclusive');
  });

  it('--stdin + --fix-dry-run → exit 2', async () => {
    const r = await runAnalyze(
      ['--stdin', '--fix-dry-run'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--stdin and --fix-dry-run are mutually exclusive');
  });

  it('--stdin + --reflect + --format=jsonl → exit 2 (reflect-vs-jsonl conflict fires)', async () => {
    // Sanity check that the prior STORY-5.3 exclusivity rule still
    // fires alongside the new --stdin flag. They compose without
    // interfering.
    const r = await runAnalyze(
      ['--stdin', '--reflect', '--format=jsonl'],
      { stdin: stdinFrom('DROP TABLE users;\n') },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--reflect conflicts with --format=jsonl');
  });
});

describe('runAnalyze --stdin — usage message', () => {
  it('missing-pattern error mentions --stdin as an alternative', async () => {
    const r = await runAnalyze([], {});
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('missing file pattern');
    expect(stderrText()).toContain('--stdin');
  });
});
