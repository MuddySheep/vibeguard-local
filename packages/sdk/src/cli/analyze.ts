// `vg-local analyze <glob...>` — file-globbing static analysis.
//
// Resolves glob patterns to file paths, parses each file as SQL,
// runs the analyzer, and prints catches per file. Exit code is
// non-zero if any `block`-severity catch fires (so it's CI-friendly:
// `pnpm lint:sql` fails the build on a SQL-003-shaped query).
//
// Glob expansion via tinyglobby (small, fast, used by tsup/vite/
// vitest internally). We pass user globs through unchanged.
//
// File-too-large guard: 5 MB. Real SQL files don't exceed this; if
// they do, the user is probably feeding a binary or a SQL dump and
// the analyzer wouldn't make sense anyway. We skip with a warning
// rather than load multi-GB files into memory.
//
// Pure inputs: `cwd`, `out`, and `err` are passed in (defaulting to
// process.cwd() / stdout / stderr at the CLI boundary). Keeps the
// function callable from worker threads where process.chdir() is
// not allowed, and keeps tests free of global-state mutation.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import pc from 'picocolors';
import { glob } from 'tinyglobby';

import { analyze, init as initParser } from '../index.js';
import type { AnalyzeOptions } from '../index.js';
import { formatCatch, formatSummary } from './format.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface AnalyzeResult {
  /** 0 if no `block`-severity catches fired, 1 if any did. 2 on usage error. */
  exitCode: 0 | 1 | 2;
  /** Total catches across all analyzed files. */
  totalCatches: number;
  /** Subset of catches that were `block` severity. */
  blockCatches: number;
  /** Number of files actually parsed (post-glob, post-size-filter). */
  filesAnalyzed: number;
}

export interface RunAnalyzeOptions {
  /** Working directory the globs resolve against. Defaults to process.cwd(). */
  readonly cwd?: string;
  /** Stdout sink. Defaults to process.stdout. */
  readonly out?: NodeJS.WritableStream;
  /** Stderr sink. Defaults to process.stderr. */
  readonly err?: NodeJS.WritableStream;
  /** Per-rule overrides forwarded to analyze(). */
  readonly analyzeOptions?: AnalyzeOptions;
}

/**
 * `vg-local analyze <glob...>` entry point.
 *
 * Caller is responsible for `process.exit(result.exitCode)` —
 * keeping the function pure makes it testable without a child
 * process spawn.
 */
export async function runAnalyze(
  args: readonly string[],
  options: RunAnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const analyzeOptions = options.analyzeOptions;

  if (args.length === 0) {
    err.write(`vg-local analyze: missing file pattern\n`);
    err.write(`Usage: vg-local analyze 'src/**/*.sql'\n`);
    return { exitCode: 2, totalCatches: 0, blockCatches: 0, filesAnalyzed: 0 };
  }

  // Resolve globs. tinyglobby normalizes Windows path separators
  // and accepts arrays of patterns directly.
  const files = await glob([...args], {
    cwd,
    onlyFiles: true,
    absolute: false,
    dot: false,
  });

  if (files.length === 0) {
    err.write(
      `vg-local analyze: no files matched ${JSON.stringify([...args])}\n`,
    );
    return { exitCode: 0, totalCatches: 0, blockCatches: 0, filesAnalyzed: 0 };
  }

  await initParser();

  let totalCatches = 0;
  let blockCatches = 0;
  let filesAnalyzed = 0;

  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolute);
    } catch (e) {
      err.write(
        `${pc.dim(file)}: ${pc.red('cannot stat')} ${(e as Error).message}\n`,
      );
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      err.write(
        `${pc.dim(file)}: ${pc.yellow(
          `skipped (size ${stat.size} exceeds ${MAX_FILE_BYTES})`,
        )}\n`,
      );
      continue;
    }

    let sql: string;
    try {
      sql = await fs.readFile(absolute, 'utf8');
    } catch (e) {
      err.write(
        `${pc.dim(file)}: ${pc.red('cannot read')} ${(e as Error).message}\n`,
      );
      continue;
    }

    const result = analyze(sql, analyzeOptions);
    filesAnalyzed++;

    if (result.parseError) {
      err.write(
        `${pc.dim(file)}: ${pc.red('parse error')} ${result.parseError.message}\n`,
      );
      continue;
    }

    for (const c of result.catches) {
      out.write(formatCatch(c, file) + '\n\n');
      totalCatches++;
      if (c.severity === 'block') blockCatches++;
    }
  }

  out.write(formatSummary(totalCatches, filesAnalyzed, blockCatches) + '\n');

  return {
    exitCode: blockCatches > 0 ? 1 : 0,
    totalCatches,
    blockCatches,
    filesAnalyzed,
  };
}
