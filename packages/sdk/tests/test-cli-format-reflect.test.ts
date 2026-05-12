import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAnalyze } from '../src/cli/analyze.js';
import {
  formatCatchReflect,
  importanceFor,
  painScoreFor,
  resultFor,
  REFLECT_SCHEMA_VERSION,
  REFLECT_SKILL_NAME,
} from '../src/cli/format-reflect.js';
import { init } from '../src/index.js';
import type { Catch } from '../src/types.js';

// EPIC-OSS-5 / STORY-5.3 — Reflection output mode (EXPERIMENTAL).
//
// Two layers under test:
//   1. The pure renderer + helpers in `src/cli/format-reflect.ts`
//      (severity/confidence mappings, action shape, schema field,
//      determinism with injected `now`, path normalization, escaping).
//   2. End-to-end: `runAnalyze` with `--reflect` / `--format=reflect`,
//      including the new mutual-exclusivity behavior with `--format`.

beforeAll(async () => {
  await init();
});

let tmpDir: string;
let stdoutCalls: string[];
let stderrCalls: string[];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-reflect-test-'));
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

// A fixed clock used by the pure-renderer tests for byte-identical
// determinism assertions. Production code always passes a real
// `new Date()`.
const FIXED_NOW = new Date('2026-05-10T12:34:56.789Z');

describe('format-reflect — pure helpers', () => {
  it('maps severity to result', () => {
    expect(resultFor('block')).toBe('blocked');
    expect(resultFor('warn')).toBe('warned');
    expect(resultFor('info')).toBe('flagged');
  });

  it('maps severity to pain_score', () => {
    expect(painScoreFor('block')).toBe(9);
    expect(painScoreFor('warn')).toBe(5);
    expect(painScoreFor('info')).toBe(2);
  });

  it('maps confidence to importance via round(confidence/10)', () => {
    expect(importanceFor(0)).toBe(0);
    expect(importanceFor(45)).toBe(5); // round(4.5) → 5
    expect(importanceFor(50)).toBe(5);
    expect(importanceFor(95)).toBe(10);
    expect(importanceFor(100)).toBe(10);
  });

  it('clamps importance defensively if confidence is out of range', () => {
    expect(importanceFor(-5)).toBe(0);
    expect(importanceFor(200)).toBe(10);
  });
});

describe('formatCatchReflect — single-line renderer', () => {
  const baseBlock: Catch = {
    code: 'SQL-013',
    title: 'DROP TABLE — irreversible table destruction',
    severity: 'block',
    confidence: 99,
    detail: 'DROP TABLE is irreversible.',
    fix: 'Use a soft-delete approach or migrate with explicit confirmation.',
    threatCategories: ['destruction'],
  };

  it('emits all required fields with expected values', () => {
    const line = formatCatchReflect(baseBlock, 'src/a.sql', FIXED_NOW);
    const parsed = JSON.parse(line);
    expect(parsed._schema).toBe(REFLECT_SCHEMA_VERSION);
    expect(parsed._schema).toBe('vg-reflect/0');
    expect(parsed.timestamp).toBe('2026-05-10T12:34:56.789Z');
    expect(parsed.skill).toBe(REFLECT_SKILL_NAME);
    expect(parsed.skill).toBe('vibeguard-sql-safety');
    expect(parsed.code).toBe('SQL-013');
    expect(parsed.severity).toBe('block');
    expect(parsed.confidence).toBe(99);
    expect(parsed.result).toBe('blocked');
    expect(parsed.pain_score).toBe(9);
    expect(parsed.importance).toBe(10);
    expect(parsed.threatCategories).toEqual(['destruction']);
    expect(parsed.file).toBe('src/a.sql');
    expect(parsed.action).toBe('vibeguard catch SQL-013 in src/a.sql');
    expect(typeof parsed.reflection).toBe('string');
    expect(typeof parsed.suggested_lesson).toBe('string');
  });

  it('produces a single line — no embedded raw newlines', () => {
    const c: Catch = {
      ...baseBlock,
      detail: 'Line one.\nLine two with "quotes" and a \\ backslash.',
      fix: 'Multi-line\nfix string',
    };
    const line = formatCatchReflect(c, 'a.sql', FIXED_NOW);
    expect(line.includes('\n')).toBe(false);
    // Round-trip preserves the original strings inside the reflection.
    const parsed = JSON.parse(line);
    expect(parsed.reflection).toContain('Line one.\nLine two');
    expect(parsed.suggested_lesson).toContain('Multi-line\nfix string');
  });

  it('reflects the catch title and detail in the reflection text', () => {
    const parsed = JSON.parse(
      formatCatchReflect(baseBlock, 'a.sql', FIXED_NOW),
    );
    expect(parsed.reflection).toContain(baseBlock.title);
    expect(parsed.reflection).toContain(baseBlock.code);
    expect(parsed.reflection).toContain(baseBlock.detail);
    expect(parsed.reflection).toContain('destruction');
  });

  it('references the fix in the suggested_lesson', () => {
    const parsed = JSON.parse(
      formatCatchReflect(baseBlock, 'a.sql', FIXED_NOW),
    );
    expect(parsed.suggested_lesson).toContain(baseBlock.code);
    expect(parsed.suggested_lesson).toContain(baseBlock.fix);
  });

  it('omits line / column when location is absent', () => {
    const parsed = JSON.parse(
      formatCatchReflect(baseBlock, 'a.sql', FIXED_NOW),
    );
    expect('line' in parsed).toBe(false);
    expect('column' in parsed).toBe(false);
  });

  it('includes line / column when location is present', () => {
    const c: Catch = { ...baseBlock, location: { line: 7, column: 3 } };
    const parsed = JSON.parse(formatCatchReflect(c, 'a.sql', FIXED_NOW));
    expect(parsed.line).toBe(7);
    expect(parsed.column).toBe(3);
    // Action string reflects the line.
    expect(parsed.action).toBe('vibeguard catch SQL-013 in a.sql:7');
  });

  it('normalizes Windows-style separators to forward slashes', () => {
    const parsed = JSON.parse(
      formatCatchReflect(baseBlock, 'src\\sub\\a.sql', FIXED_NOW),
    );
    expect(parsed.file).toBe('src/sub/a.sql');
    expect(parsed.action).toBe('vibeguard catch SQL-013 in src/sub/a.sql');
  });

  it('is deterministic when `now` is injected', () => {
    const a = formatCatchReflect(baseBlock, 'a.sql', FIXED_NOW);
    const b = formatCatchReflect(baseBlock, 'a.sql', FIXED_NOW);
    expect(a).toBe(b);
  });

  it('emits a valid ISO 8601 timestamp when default clock is used', () => {
    const line = formatCatchReflect(baseBlock, 'a.sql');
    const parsed = JSON.parse(line);
    const ts: string = parsed.timestamp;
    // Round-trips through Date — proves it's a valid ISO 8601 string.
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('maps a warn-severity catch to result=warned, pain=5', () => {
    const c: Catch = {
      ...baseBlock,
      code: 'SQL-005',
      severity: 'warn',
      confidence: 50,
    };
    const parsed = JSON.parse(formatCatchReflect(c, 'a.sql', FIXED_NOW));
    expect(parsed.result).toBe('warned');
    expect(parsed.pain_score).toBe(5);
    expect(parsed.importance).toBe(5);
  });

  it('maps an info-severity catch to result=flagged, pain=2', () => {
    const c: Catch = {
      ...baseBlock,
      code: 'SQL-009',
      severity: 'info',
      confidence: 30,
    };
    const parsed = JSON.parse(formatCatchReflect(c, 'a.sql', FIXED_NOW));
    expect(parsed.result).toBe('flagged');
    expect(parsed.pain_score).toBe(2);
    expect(parsed.importance).toBe(3);
  });
});

describe('runAnalyze --reflect — end-to-end', () => {
  it('emits one reflection JSON object per catch on stdout', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(['drop.sql', '--reflect'], { cwd: tmpDir });
    expect(r.exitCode).toBe(1);
    const lines = stdoutLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed._schema).toBe('vg-reflect/0');
      expect(parsed.skill).toBe('vibeguard-sql-safety');
      expect(typeof parsed.timestamp).toBe('string');
      expect(['block', 'warn', 'info']).toContain(parsed.severity);
      expect(['blocked', 'warned', 'flagged']).toContain(parsed.result);
      expect(typeof parsed.pain_score).toBe('number');
      expect(typeof parsed.importance).toBe('number');
      expect(typeof parsed.reflection).toBe('string');
      expect(typeof parsed.suggested_lesson).toBe('string');
    }
  });

  it('--format=reflect is byte-identical when timestamps are equal', async () => {
    // Use options.format override to skip flag parsing; the bytes diff
    // would only be in the timestamp string between two real runs.
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    await runAnalyze(['drop.sql'], { cwd: tmpDir, format: 'reflect' });
    const a = stdoutLines().map((l) => {
      const p = JSON.parse(l);
      delete p.timestamp;
      return JSON.stringify(p);
    });

    stdoutCalls = [];
    stderrCalls = [];
    await runAnalyze(['drop.sql', '--reflect'], { cwd: tmpDir });
    const b = stdoutLines().map((l) => {
      const p = JSON.parse(l);
      delete p.timestamp;
      return JSON.stringify(p);
    });

    expect(a).toEqual(b);
  });

  it('emits zero bytes on stdout when there are no catches', async () => {
    await writeSql('clean.sql', 'SELECT id FROM users WHERE id = 1;\n');
    const r = await runAnalyze(['clean.sql', '--reflect'], { cwd: tmpDir });
    expect(r.exitCode).toBe(0);
    expect(stdoutText()).toBe('');
  });

  it('keeps parse errors on stderr, not on stdout', async () => {
    await writeSql('bad.sql', 'SELEKT 1 FROM @\n');
    await runAnalyze(['bad.sql', '--reflect'], { cwd: tmpDir });
    expect(stderrText()).toContain('parse error');
    for (const line of stdoutLines()) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('suppresses the human summary in reflect mode', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    await runAnalyze(['drop.sql', '--reflect'], { cwd: tmpDir });
    const out = stdoutText();
    expect(out).not.toContain('catch in');
    expect(out).not.toContain('catches in');
  });
});

describe('runAnalyze --reflect — mutual exclusivity with --format', () => {
  it('--reflect + --format=jsonl exits 2 with usage message', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--reflect', '--format=jsonl'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--reflect conflicts with --format=jsonl');
  });

  it('--reflect + --format=ndjson exits 2', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--reflect', '--format=ndjson'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--reflect conflicts');
  });

  it('--reflect + --format=human exits 2', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--reflect', '--format=human'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('--reflect conflicts');
  });

  it('--reflect + --format=reflect is accepted (both agree)', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--reflect', '--format=reflect'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(1);
    // Reflect mode emitted.
    const lines = stdoutLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(JSON.parse(line)._schema).toBe('vg-reflect/0');
    }
  });

  it('--format=reflect alone (no --reflect flag) works', async () => {
    await writeSql('drop.sql', 'DROP TABLE users;\n');
    const r = await runAnalyze(
      ['drop.sql', '--format=reflect'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(1);
    for (const line of stdoutLines()) {
      expect(JSON.parse(line)._schema).toBe('vg-reflect/0');
    }
  });

  it('updates the unknown --format usage message to list reflect', async () => {
    const r = await runAnalyze(
      ['x.sql', '--format=xml'],
      { cwd: tmpDir },
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('human, jsonl, ndjson, reflect');
  });
});
