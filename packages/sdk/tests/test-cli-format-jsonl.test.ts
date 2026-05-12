import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAnalyze } from '../src/cli/analyze.js';
import { formatCatchJsonl, JSONL_SCHEMA_VERSION } from '../src/cli/format-jsonl.js';
import { init } from '../src/index.js';
import type { Catch } from '../src/types.js';

// EPIC-OSS-5 / STORY-5.1 — JSONL output mode.
//
// Two layers under test:
//   1. The pure renderer `formatCatchJsonl(c, file)` — exhaustive
//      assertions on its output shape (schema field, escaping,
//      path normalization, optional location).
//   2. End-to-end: `runAnalyze` with `--format=jsonl` / `--format=ndjson`
//      / `--format=human` / unknown values, plus interactions with
//      `--fix` and `--fix-dry-run`.

beforeAll(async () => {
  await init();
});

let tmpDir: string;
let stdoutCalls: string[];
let stderrCalls: string[];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-jsonl-test-'));
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
function stdoutLines(): string[] {
  return stdoutText().split('\n').filter((line) => line.length > 0);
}

async function writeSql(name: string, content: string): Promise<void> {
  const full = path.join(tmpDir, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

describe('formatCatchJsonl — pure renderer', () => {
  it('emits one JSON object with all required fields', () => {
    const c: Catch = {
      code: 'SQL-001',
      title: 'Cartesian explosion risk',
      severity: 'block',
      confidence: 95,
      detail: 'A FROM clause lists multiple tables with no join condition.',
      fix: 'Add an explicit JOIN ... ON clause.',
      threatCategories: ['denial-of-service'],
    };
    const line = formatCatchJsonl(c, 'src/queries.sql');
    const parsed = JSON.parse(line);
    expect(parsed._schema).toBe(JSONL_SCHEMA_VERSION);
    expect(parsed._schema).toBe('vg-jsonl/1');
    expect(parsed.code).toBe('SQL-001');
    expect(parsed.severity).toBe('block');
    expect(parsed.confidence).toBe(95);
    expect(parsed.title).toBe('Cartesian explosion risk');
    expect(parsed.detail).toBe(c.detail);
    expect(parsed.fix).toBe(c.fix);
    expect(parsed.threatCategories).toEqual(['denial-of-service']);
    expect(parsed.file).toBe('src/queries.sql');
  });

  it('omits line/column when location is absent', () => {
    const c: Catch = {
      code: 'SQL-013',
      title: 'DROP/TRUNCATE on a non-temporary table',
      severity: 'block',
      confidence: 99,
      detail: 'irreversible',
      fix: 'add IF EXISTS or back up first',
      threatCategories: ['destruction'],
    };
    const parsed = JSON.parse(formatCatchJsonl(c, 'a.sql'));
    expect('line' in parsed).toBe(false);
    expect('column' in parsed).toBe(false);
  });

  it('includes line/column when location is present', () => {
    const c: Catch = {
      code: 'SQL-001',
      title: 't',
      severity: 'block',
      confidence: 90,
      detail: 'd',
      fix: 'f',
      threatCategories: ['denial-of-service'],
      location: { line: 12, column: 4 },
    };
    const parsed = JSON.parse(formatCatchJsonl(c, 'a.sql'));
    expect(parsed.line).toBe(12);
    expect(parsed.column).toBe(4);
  });

  it('normalizes backslash separators to forward slashes', () => {
    const c: Catch = {
      code: 'SQL-001',
      title: 't',
      severity: 'block',
      confidence: 90,
      detail: 'd',
      fix: 'f',
      threatCategories: ['denial-of-service'],
    };
    // Simulate a Windows-style path.
    const parsed = JSON.parse(formatCatchJsonl(c, 'src\\nested\\queries.sql'));
    expect(parsed.file).toBe('src/nested/queries.sql');
  });

  it('escapes embedded newlines, quotes, and backslashes', () => {
    const c: Catch = {
      code: 'SQL-008',
      title: 'String concatenation in SQL',
      severity: 'warn',
      confidence: 70,
      detail: 'Multi-line\ndetail with "quotes" and a backslash \\ in it.',
      fix: 'Use parameterized queries.\nDocumented at example.com',
      threatCategories: ['injection'],
    };
    const line = formatCatchJsonl(c, 'a.sql');
    // Renderer output must be a single line — no raw embedded \n in the
    // string representation (JSON.stringify escapes them to "\\n").
    expect(line.includes('\n')).toBe(false);
    // Round-trip preserves the original payload.
    const parsed = JSON.parse(line);
    expect(parsed.detail).toBe(c.detail);
    expect(parsed.fix).toBe(c.fix);
  });

  it('produces deterministic field ordering', () => {
    const c: Catch = {
      code: 'SQL-015',
      title: 't',
      severity: 'warn',
      confidence: 60,
      detail: 'd',
      fix: 'f',
      threatCategories: ['exfiltration'],
    };
    const a = formatCatchJsonl(c, 'a.sql');
    const b = formatCatchJsonl(c, 'a.sql');
    expect(a).toBe(b);
    // The fixed key order is the contract; assert via positional index
    // of the schema key (must be first).
    expect(a.indexOf('"_schema"')).toBe(1);
  });
});

describe('runAnalyze --format=jsonl — stdout shape', () => {
  it('emits one JSON object per catch, newline-terminated', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(1);
    expect(r.blockCatches).toBeGreaterThanOrEqual(1);
    const lines = stdoutLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed._schema).toBe('vg-jsonl/1');
      expect(typeof parsed.code).toBe('string');
      expect(['block', 'warn', 'info']).toContain(parsed.severity);
      expect(Number.isInteger(parsed.confidence)).toBe(true);
      expect(parsed.confidence).toBeGreaterThanOrEqual(0);
      expect(parsed.confidence).toBeLessThanOrEqual(100);
      expect(typeof parsed.file).toBe('string');
      expect(Array.isArray(parsed.threatCategories)).toBe(true);
      expect(parsed.threatCategories.length).toBeGreaterThan(0);
    }
  });

  it('emits zero bytes to stdout when there are no catches', async () => {
    await writeSql('clean.sql', 'SELECT id FROM users WHERE id = 1;\n');
    const r = await runAnalyze(
      ['clean.sql', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.totalCatches).toBe(0);
    expect(stdoutText()).toBe('');
  });

  it('emits no summary line in JSONL mode', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    await runAnalyze(['drop.sql', '--format=jsonl'], { cwd: tmpDir });
    expect(stdoutText()).not.toContain('catches in');
    expect(stdoutText()).not.toContain('catch in');
  });

  it('--format=ndjson is byte-identical to --format=jsonl', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    await runAnalyze(['drop.sql', '--format=jsonl'], { cwd: tmpDir });
    const jsonlOut = stdoutText();

    // Reset spies and re-run with ndjson.
    stdoutCalls = [];
    stderrCalls = [];
    await runAnalyze(['drop.sql', '--format=ndjson'], { cwd: tmpDir });
    const ndjsonOut = stdoutText();

    expect(ndjsonOut).toBe(jsonlOut);
  });

  it('--format=human (explicit) matches default human output', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    await runAnalyze(['drop.sql', '--format=human'], { cwd: tmpDir });
    const explicitHuman = stdoutText();

    stdoutCalls = [];
    stderrCalls = [];
    await runAnalyze(['drop.sql'], { cwd: tmpDir });
    const defaultHuman = stdoutText();

    expect(explicitHuman).toBe(defaultHuman);
    expect(explicitHuman).toContain('SQL-013');
    // Summary formatter uses singular/plural grammar correctly; just
    // assert presence of the "in 1 file" tail rather than a specific
    // count word.
    expect(explicitHuman).toContain('in 1 file');
  });
});

describe('runAnalyze --format=jsonl — exit codes', () => {
  it('returns 0 when only warn/info catches fire', async () => {
    await writeSql('star.sql', 'SELECT * FROM users WHERE id = 1;\n');
    const r = await runAnalyze(
      ['star.sql', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.blockCatches).toBe(0);
    expect(r.totalCatches).toBeGreaterThanOrEqual(1);
  });

  it('returns 1 when any block-severity catch fires', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(1);
  });

  it('returns 2 with usage error on unknown --format value', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--format=xml'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('unknown --format');
    expect(stderrText()).toContain('"xml"');
    expect(stderrText()).toContain('human, jsonl, ndjson');
  });
});

describe('runAnalyze --format=jsonl — error handling', () => {
  it('keeps parse errors on stderr (NOT on stdout as JSONL)', async () => {
    await writeSql('good.sql', 'DROP TABLE x;\n');
    await writeSql('bad.sql', 'SELEKT 1 FROM @\n');
    const r = await runAnalyze(
      ['*.sql', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.filesAnalyzed).toBe(2);
    expect(stderrText()).toContain('parse error');
    // stdout has only valid JSONL lines (no human-text parse-error lines)
    for (const line of stdoutLines()) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('keeps skip-warnings on stderr', async () => {
    const big = 'A'.repeat(6 * 1024 * 1024);
    await writeSql('big.sql', big);
    const r = await runAnalyze(
      ['big.sql', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.filesAnalyzed).toBe(0);
    expect(stderrText()).toContain('skipped');
    expect(stdoutText()).toBe('');
  });
});

describe('runAnalyze --format=jsonl — interaction with --fix-dry-run', () => {
  it('emits catches as JSONL but suppresses the diff', async () => {
    await writeSql('star.sql', 'SELECT * FROM users WHERE id = 1;\n');
    const r = await runAnalyze(
      ['star.sql', '--fix-dry-run', '--format=jsonl'],
      { cwd: tmpDir },
    );
    // Either zero catches (if fixer resolved SQL-015) or some catches —
    // either way the stdout must be valid JSONL, never a diff.
    const out = stdoutText();
    // No diff markers (those start with `---` / `+++` / `@@`).
    expect(out).not.toContain('--- ');
    expect(out).not.toContain('+++ ');
    expect(out).not.toContain('@@');
    // No human "would apply" trailer.
    expect(out).not.toContain('would apply');
    // Every nonempty line is valid JSON.
    for (const line of stdoutLines()) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // Exit code unchanged from the equivalent human-mode run.
    expect([0, 1]).toContain(r.exitCode);
  });
});

describe('runAnalyze --format=jsonl — interaction with --fix', () => {
  it('writes files in place and emits remaining catches as JSONL', async () => {
    // Use a SQL pattern that produces a fixable catch (SELECT * → fixer
    // doesn't auto-resolve, but the file IS written. We assert on the
    // stdout shape — JSONL only, no "fixed" informational line.)
    await writeSql('star.sql', 'SELECT * FROM users WHERE id = 1;\n');
    await runAnalyze(
      ['star.sql', '--fix', '--format=jsonl'],
      { cwd: tmpDir },
    );
    const out = stdoutText();
    expect(out).not.toContain('fixed ');
    expect(out).not.toContain('applied');
    expect(out).not.toContain('catches in');
    for (const line of stdoutLines()) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('still errors when --fix and --fix-dry-run are both set', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--fix', '--fix-dry-run', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('mutually exclusive');
  });
});

describe('runAnalyze --format=jsonl — file path normalization end-to-end', () => {
  it('emits forward-slash paths even when glob returns nested files', async () => {
    await writeSql('src/sub/q.sql', 'DROP TABLE x;\n');
    await runAnalyze(['src/**/*.sql', '--format=jsonl'], { cwd: tmpDir });
    const lines = stdoutLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.file).not.toContain('\\');
      expect(parsed.file).toMatch(/^src\/sub\/q\.sql$/);
    }
  });
});
