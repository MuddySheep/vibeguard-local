// `vg-local analyze <glob...> [--fix | --fix-dry-run]` —
// file-globbing static analysis with optional autofix.
//
// Modes:
//   off       (default) — print catches; exit 1 if any block-severity
//                         catch fires
//   apply     (--fix)   — apply autofixes in place, write changed files
//                         back to disk; exit 1 if any block remains
//                         after fixing
//   dry-run   (--fix-dry-run) — apply autofixes in memory, print a
//                         unified diff per changed file; do NOT write;
//                         exit code mirrors `off` mode (block-aware)
//
// Both --fix and --fix-dry-run together is a usage error (exit 2).
//
// File handling: per-file pipeline is parse → analyze → (optional)
// applyFixes → render → (optional) write. Files >5 MB are skipped
// with a stderr warning. Parse errors per file are reported via
// stderr without stopping the run.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import pc from 'picocolors';
import { glob } from 'tinyglobby';

import { analyze, applyFixes, init as initParser } from '../index.js';
import type { AnalyzeOptions } from '../index.js';
import { unifiedDiff } from './diff.js';
import { formatCatch, formatSummary } from './format.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type FixMode = 'off' | 'apply' | 'dry-run';

export interface AnalyzeResult {
  /** 0 if no `block` catches remain; 1 if any do. 2 on usage error. */
  exitCode: 0 | 1 | 2;
  totalCatches: number;
  blockCatches: number;
  filesAnalyzed: number;
  /** V1.3 — files that had at least one fix applied (or proposed). */
  filesFixed: number;
  /** V1.3 — total fixes applied (or proposed in dry-run mode). */
  fixesApplied: number;
}

export interface RunAnalyzeOptions {
  readonly cwd?: string;
  readonly out?: NodeJS.WritableStream;
  readonly err?: NodeJS.WritableStream;
  readonly analyzeOptions?: AnalyzeOptions;
  /**
   * V1.3+ override that bypasses --fix / --fix-dry-run flag parsing
   * (useful for tests). When omitted, mode is parsed from args.
   */
  readonly fixMode?: FixMode;
}

/**
 * `vg-local analyze <glob>... [--fix | --fix-dry-run]` entry point.
 */
export async function runAnalyze(
  args: readonly string[],
  options: RunAnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const analyzeOptions = options.analyzeOptions;

  // Separate flags from glob patterns.
  let seenFix = false;
  let seenDryRun = false;
  const globs: string[] = [];
  for (const arg of args) {
    if (arg === '--fix') seenFix = true;
    else if (arg === '--fix-dry-run') seenDryRun = true;
    else globs.push(arg);
  }
  if (seenFix && seenDryRun) {
    err.write(
      `vg-local analyze: --fix and --fix-dry-run are mutually exclusive\n`,
    );
    return baseResult(2);
  }
  const fixMode: FixMode =
    options.fixMode ?? (seenFix ? 'apply' : seenDryRun ? 'dry-run' : 'off');

  if (globs.length === 0) {
    err.write(`vg-local analyze: missing file pattern\n`);
    err.write(`Usage: vg-local analyze 'src/**/*.sql' [--fix | --fix-dry-run]\n`);
    return baseResult(2);
  }

  const files = await glob(globs, {
    cwd,
    onlyFiles: true,
    absolute: false,
    dot: false,
  });

  if (files.length === 0) {
    err.write(
      `vg-local analyze: no files matched ${JSON.stringify(globs)}\n`,
    );
    return baseResult(0);
  }

  await initParser();

  let totalCatches = 0;
  let blockCatches = 0;
  let filesAnalyzed = 0;
  let filesFixed = 0;
  let fixesApplied = 0;

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

    if (fixMode === 'off') {
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
      continue;
    }

    // --fix or --fix-dry-run path: run the autofix runner first, then
    // render whatever catches remain afterward.
    // exactOptionalPropertyTypes forbids passing { foo: undefined } —
    // spread only the keys that are actually set.
    const fixResult = applyFixes(sql, {
      ...(analyzeOptions?.rules !== undefined
        ? { rules: analyzeOptions.rules }
        : {}),
      ...(analyzeOptions?.logger !== undefined
        ? { logger: analyzeOptions.logger }
        : {}),
    });
    filesAnalyzed++;

    // The runner internally re-parses and verifies; if the input
    // was malformed, applyFixes returns the input unchanged with no
    // catches. Surface the parse error explicitly so the caller knows.
    if (!fixResult.changed && sql !== '') {
      const result = analyze(sql, analyzeOptions);
      if (result.parseError) {
        err.write(
          `${pc.dim(file)}: ${pc.red('parse error')} ${result.parseError.message}\n`,
        );
        continue;
      }
    }

    if (fixResult.changed) {
      filesFixed++;
      fixesApplied += fixResult.fixesApplied;
      if (fixMode === 'apply') {
        try {
          await fs.writeFile(absolute, fixResult.sql, 'utf8');
          out.write(
            `${pc.green('fixed')} ${pc.dim(file)} (${fixResult.fixesApplied} change${fixResult.fixesApplied === 1 ? '' : 's'})\n`,
          );
        } catch (e) {
          err.write(
            `${pc.dim(file)}: ${pc.red('cannot write')} ${(e as Error).message}\n`,
          );
        }
      } else {
        // dry-run — print a unified diff
        out.write(
          unifiedDiff(sql, fixResult.sql, { label: file }) + '\n\n',
        );
      }
    }

    // Surface any catches that the runner couldn't fix.
    for (const c of fixResult.remainingCatches) {
      out.write(formatCatch(c, file) + '\n\n');
      totalCatches++;
      if (c.severity === 'block') blockCatches++;
    }
  }

  out.write(formatSummary(totalCatches, filesAnalyzed, blockCatches) + '\n');
  if (fixMode !== 'off' && fixesApplied > 0) {
    const verb = fixMode === 'apply' ? 'applied' : 'would apply';
    const fixWord = fixesApplied === 1 ? 'fix' : 'fixes';
    const fileWord = filesFixed === 1 ? 'file' : 'files';
    out.write(
      pc.bold(
        `${verb} ${fixesApplied} ${fixWord} across ${filesFixed} ${fileWord}.\n`,
      ),
    );
    if (fixMode === 'dry-run') {
      out.write(pc.dim('Run with --fix to write changes to disk.\n'));
    }
  }

  return {
    exitCode: blockCatches > 0 ? 1 : 0,
    totalCatches,
    blockCatches,
    filesAnalyzed,
    filesFixed,
    fixesApplied,
  };
}

function baseResult(exitCode: 0 | 1 | 2): AnalyzeResult {
  return {
    exitCode,
    totalCatches: 0,
    blockCatches: 0,
    filesAnalyzed: 0,
    filesFixed: 0,
    fixesApplied: 0,
  };
}
