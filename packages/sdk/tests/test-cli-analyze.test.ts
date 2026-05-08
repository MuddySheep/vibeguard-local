import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAnalyze } from '../src/cli/analyze.js';
import { init } from '../src/index.js';

// V1.2 — analyze subcommand tests.
//
// runAnalyze accepts `cwd` as a parameter (defaulting to
// process.cwd() at the CLI boundary). Each test gets its own tmp dir
// and passes it explicitly. No process.chdir() — that's not
// supported in vitest's worker threads. stdout/stderr writes go
// through spies so the test runner stays quiet AND we can assert
// on rendered output.

beforeAll(async () => {
  await init();
});

let tmpDir: string;
let stdoutCalls: string[];
let stderrCalls: string[];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-analyze-test-'));
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

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

function stdoutText(): string {
  return stdoutCalls.join('');
}
function stderrText(): string {
  return stderrCalls.join('');
}

async function writeSql(name: string, content: string): Promise<void> {
  const full = path.join(tmpDir, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

describe('runAnalyze — exit codes', () => {
  it('returns 2 when no globs supplied', async () => {
    const r = await runAnalyze([], { cwd: tmpDir });
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('missing file pattern');
  });

  it('returns 0 when nothing matches the glob (with stderr message)', async () => {
    const r = await runAnalyze(['nonexistent/*.sql'], { cwd: tmpDir });
    expect(r.exitCode).toBe(0);
    expect(r.filesAnalyzed).toBe(0);
    expect(stderrText()).toContain('no files matched');
  });

  it('returns 0 when matched files have no catches', async () => {
    await writeSql('clean.sql', 'SELECT id FROM users WHERE id = 1;\n');
    const r = await runAnalyze(['clean.sql'], { cwd: tmpDir });
    expect(r.exitCode).toBe(0);
    expect(r.totalCatches).toBe(0);
    expect(r.filesAnalyzed).toBe(1);
    expect(stdoutText()).toContain('0 catches in 1 file');
  });

  it('returns 1 when any block-severity catch fires', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(['drop.sql'], { cwd: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.blockCatches).toBeGreaterThanOrEqual(1);
    expect(stdoutText()).toContain('SQL-013');
    expect(stdoutText()).toContain('block · 99');
  });

  it('returns 0 when only warn / info catches fire (no block)', async () => {
    await writeSql('star.sql', 'SELECT * FROM users WHERE id = 1;\n');
    const r = await runAnalyze(['star.sql'], { cwd: tmpDir });
    expect(r.exitCode).toBe(0);
    expect(r.blockCatches).toBe(0);
    expect(r.totalCatches).toBeGreaterThanOrEqual(1);
    expect(stdoutText()).toContain('SQL-015');
  });
});

describe('runAnalyze — glob expansion', () => {
  it('analyzes multiple files matched by a single glob', async () => {
    await writeSql('a.sql', 'SELECT * FROM a;\n');
    await writeSql('b.sql', 'DROP TABLE b;\n');
    const r = await runAnalyze(['*.sql'], { cwd: tmpDir });
    expect(r.filesAnalyzed).toBe(2);
    expect(r.totalCatches).toBeGreaterThanOrEqual(2);
    expect(r.blockCatches).toBeGreaterThanOrEqual(1);
    expect(r.exitCode).toBe(1);
  });

  it('accepts multiple glob arguments', async () => {
    await writeSql('src/q1.sql', 'SELECT id FROM users WHERE id = 1;\n');
    await writeSql('migrations/0001.sql', 'DROP TABLE users;\n');

    const r = await runAnalyze(
      ['src/**/*.sql', 'migrations/*.sql'],
      { cwd: tmpDir },
    );
    expect(r.filesAnalyzed).toBe(2);
    expect(r.exitCode).toBe(1);
  });

  it('does not analyze unmatched files', async () => {
    await writeSql('match.sql', 'DROP TABLE x;\n');
    await writeSql('skip.txt', 'DROP TABLE y;\n');
    const r = await runAnalyze(['*.sql'], { cwd: tmpDir });
    expect(r.filesAnalyzed).toBe(1);
  });
});

describe('runAnalyze — error handling', () => {
  it('reports parse errors via stderr without crashing the run', async () => {
    await writeSql('good.sql', 'DROP TABLE x;\n');
    await writeSql('bad.sql', 'SELEKT 1 FROM @\n');
    const r = await runAnalyze(['*.sql'], { cwd: tmpDir });
    expect(r.filesAnalyzed).toBe(2);
    expect(stderrText()).toContain('parse error');
    expect(stdoutText()).toContain('SQL-013');
  });

  it('skips files larger than the size cap', async () => {
    const big = 'A'.repeat(6 * 1024 * 1024);
    await writeSql('big.sql', big);
    const r = await runAnalyze(['big.sql'], { cwd: tmpDir });
    expect(r.filesAnalyzed).toBe(0);
    expect(stderrText()).toContain('skipped');
  });
});

describe('runAnalyze — analyzeOptions opt-in', () => {
  it('opts in to SQL-014 via analyzeOptions.rules', async () => {
    await writeSql(
      'insert.sql',
      "INSERT INTO users (email) VALUES ('a@b.com');\n",
    );
    const rDefault = await runAnalyze(['insert.sql'], { cwd: tmpDir });
    expect(rDefault.totalCatches).toBe(0);

    stdoutCalls = [];
    stderrCalls = [];

    const rOptIn = await runAnalyze(['insert.sql'], {
      cwd: tmpDir,
      analyzeOptions: { rules: { 'sql-014': { enabled: true } } },
    });
    expect(rOptIn.totalCatches).toBeGreaterThanOrEqual(1);
    expect(stdoutText()).toContain('SQL-014');
  });
});
