// `vg-local analyze <glob...> [--fix | --fix-dry-run] [--format=<fmt>] [--reflect]` —
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
// Output formats (Epic 5):
//   human  (default)             — pretty-printed catches with color +
//                                  summary line. Suitable for terminals
//                                  and CI logs read by humans.
//   jsonl                        — one JSON object per catch on stdout,
//                                  parseable by agent harnesses and
//                                  data pipelines. Stable schema; see
//                                  STABILITY.md "JSONL output schema."
//   ndjson                       — alias for `jsonl`. Same bytes.
//   reflect (EXPERIMENTAL)       — one reflection JSON object per catch,
//                                  designed for agent episodic-memory
//                                  ingestion. Schema is `vg-reflect/0`
//                                  and is NOT under semver commitments;
//                                  see STABILITY.md "Reflection output
//                                  schema (EXPERIMENTAL)".
//
// The convenience flag `--reflect` is sugar for `--format=reflect`. If
// both are specified and the format value disagrees with reflect, the
// invocation is a usage error (exit 2), matching the established
// `--fix` / `--fix-dry-run` mutual-exclusivity pattern.
//
// In any non-human format (`jsonl` / `ndjson` / `reflect`):
//   - stdout carries ONLY structured records, one JSON object per line
//   - the human summary line + autofix-result lines + dry-run diffs
//     are suppressed entirely (informational; if needed, run the
//     human format separately)
//   - parse errors and skip warnings continue to go to stderr as
//     plain text — same as human mode
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
import { formatCatchJsonl } from './format-jsonl.js';
import { formatCatchReflect } from './format-reflect.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type FixMode = 'off' | 'apply' | 'dry-run';

/**
 * Output format for the analyze subcommand. `ndjson` is accepted at the
 * flag layer as an alias and resolves to `jsonl` internally — same
 * emitter, same bytes. `reflect` is EXPERIMENTAL (V0); the schema is
 * NOT under STABILITY.md semver commitments.
 */
export type Format = 'human' | 'jsonl' | 'reflect';

/** Accepted user-facing flag values. Centralized for the usage message. */
const FORMAT_VALUES = ['human', 'jsonl', 'ndjson', 'reflect'] as const;

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
  /**
   * Epic 5 — override that bypasses --format flag parsing (useful for
   * tests). When omitted, format is parsed from args; default `human`.
   */
  readonly format?: Format;
  /**
   * Epic 5 Story 5.4 — when --stdin is set, this is the stream the
   * analyzer reads SQL from. Defaults to `process.stdin`. Tests pass
   * a `Readable.from([buf])` so they don't have to touch the real
   * process.stdin (which vitest's worker model treats as a TTY).
   */
  readonly stdin?: NodeJS.ReadableStream;
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
  let seenReflect = false;
  let seenStdin = false;
  let parsedFormat: Format | undefined;
  let formatParseError: string | undefined;
  const globs: string[] = [];
  for (const arg of args) {
    if (arg === '--fix') seenFix = true;
    else if (arg === '--fix-dry-run') seenDryRun = true;
    else if (arg === '--reflect') seenReflect = true;
    else if (arg === '--stdin') seenStdin = true;
    else if (arg.startsWith('--format=')) {
      // --format=<value> — single-arg form. We deliberately do NOT
      // support the two-arg `--format <value>` form; sticking to
      // KEY=VALUE keeps the parser stupidly simple and predictable.
      const raw = arg.slice('--format='.length);
      if (raw === 'human') parsedFormat = 'human';
      else if (raw === 'jsonl' || raw === 'ndjson') parsedFormat = 'jsonl';
      else if (raw === 'reflect') parsedFormat = 'reflect';
      else {
        // Defer reporting until after the --fix exclusivity check so
        // the most-specific error fires last; but capture the offender
        // string so the message can name it.
        formatParseError = raw;
      }
    } else globs.push(arg);
  }
  if (seenFix && seenDryRun) {
    err.write(
      `vg-local analyze: --fix and --fix-dry-run are mutually exclusive\n`,
    );
    return baseResult(2);
  }
  if (formatParseError !== undefined) {
    err.write(
      `vg-local analyze: unknown --format value ${JSON.stringify(formatParseError)}\n`,
    );
    err.write(
      `Valid values: ${FORMAT_VALUES.join(', ')}\n`,
    );
    return baseResult(2);
  }
  // --reflect is sugar for --format=reflect. If both are specified and
  // disagree, that's a usage error — matches the --fix / --fix-dry-run
  // precedent. If they agree (or only --reflect is set), reflect mode
  // takes effect.
  if (seenReflect && parsedFormat !== undefined && parsedFormat !== 'reflect') {
    err.write(
      `vg-local analyze: --reflect conflicts with --format=${parsedFormat}\n`,
    );
    err.write(
      `--reflect is sugar for --format=reflect; either drop --reflect or use --format=reflect.\n`,
    );
    return baseResult(2);
  }
  // --stdin reads SQL from process stdin. It is mutually exclusive
  // with positional glob args (single input source per call) and with
  // --fix / --fix-dry-run (no file on disk to write back to). A
  // future story may add `--stdin --fix` as stream-rewrite-with-fix;
  // it's deliberately scoped out here.
  if (seenStdin && globs.length > 0) {
    err.write(
      `vg-local analyze: --stdin and positional file patterns are mutually exclusive\n`,
    );
    err.write(
      `Pass either --stdin (read from stdin) or one or more globs (read from disk), not both.\n`,
    );
    return baseResult(2);
  }
  if (seenStdin && seenFix) {
    err.write(
      `vg-local analyze: --stdin and --fix are mutually exclusive\n`,
    );
    err.write(
      `--fix writes files in place; there is no file to write when input is stdin.\n`,
    );
    return baseResult(2);
  }
  if (seenStdin && seenDryRun) {
    err.write(
      `vg-local analyze: --stdin and --fix-dry-run are mutually exclusive\n`,
    );
    err.write(
      `--fix-dry-run prints a unified diff against the on-disk source; there is no source file when input is stdin.\n`,
    );
    return baseResult(2);
  }
  const fixMode: FixMode =
    options.fixMode ?? (seenFix ? 'apply' : seenDryRun ? 'dry-run' : 'off');
  const format: Format =
    options.format ?? parsedFormat ?? (seenReflect ? 'reflect' : 'human');

  // --stdin branch — read SQL from the input stream and run the
  // analyzer against a single in-memory input. Output respects
  // --format / --reflect. --fix / --fix-dry-run are blocked above.
  if (seenStdin) {
    await initParser();

    const stdinStream = options.stdin ?? process.stdin;
    const readResult = await readStdin(stdinStream, MAX_FILE_BYTES);
    if (!readResult.ok) {
      // Size-cap exceeded. stderr message mirrors the file-mode
      // "skipped (size N exceeds CAP)" shape but does not say
      // "skipped" because there is no next file to continue with —
      // stdin was the only input. Exit 1 so the caller sees the
      // failure clearly rather than a silent zero.
      err.write(
        `${pc.dim('<stdin>')}: ${pc.yellow(readResult.error)}\n`,
      );
      return baseResult(1);
    }

    const sql = readResult.sql;
    const file = '<stdin>';
    let stdinTotalCatches = 0;
    let stdinBlockCatches = 0;

    const result = analyze(sql, analyzeOptions);
    if (result.parseError) {
      err.write(
        `${pc.dim(file)}: ${pc.red('parse error')} ${result.parseError.message}\n`,
      );
    } else {
      for (const c of result.catches) {
        writeCatch(out, c, file, format);
        stdinTotalCatches++;
        if (c.severity === 'block') stdinBlockCatches++;
      }
    }

    if (format === 'human') {
      out.write(formatSummary(stdinTotalCatches, 1, stdinBlockCatches) + '\n');
    }

    return {
      exitCode: stdinBlockCatches > 0 ? 1 : 0,
      totalCatches: stdinTotalCatches,
      blockCatches: stdinBlockCatches,
      filesAnalyzed: 1,
      filesFixed: 0,
      fixesApplied: 0,
    };
  }

  if (globs.length === 0) {
    err.write(`vg-local analyze: missing file pattern\n`);
    err.write(
      `Usage: vg-local analyze 'src/**/*.sql' [--fix | --fix-dry-run] [--format=<fmt>]\n`,
    );
    err.write(
      `   or: vg-local analyze --stdin [--format=<fmt>]   (read SQL from stdin)\n`,
    );
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
        writeCatch(out, c, file, format);
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
          // Informational "fixed file (N changes)" line is suppressed in
          // any non-human format (jsonl, ndjson, reflect) — stdout is
          // reserved for structured records.
          if (format === 'human') {
            out.write(
              `${pc.green('fixed')} ${pc.dim(file)} (${fixResult.fixesApplied} change${fixResult.fixesApplied === 1 ? '' : 's'})\n`,
            );
          }
        } catch (e) {
          err.write(
            `${pc.dim(file)}: ${pc.red('cannot write')} ${(e as Error).message}\n`,
          );
        }
      } else {
        // dry-run — print a unified diff in human mode; suppressed in
        // jsonl / ndjson / reflect modes (caller can re-run with
        // --format=human if they want the diff).
        if (format === 'human') {
          out.write(
            unifiedDiff(sql, fixResult.sql, { label: file }) + '\n\n',
          );
        }
      }
    }

    // Surface any catches that the runner couldn't fix.
    for (const c of fixResult.remainingCatches) {
      writeCatch(out, c, file, format);
      totalCatches++;
      if (c.severity === 'block') blockCatches++;
    }
  }

  // The summary line + fix-result trailer are human-format only. All
  // structured formats (jsonl, ndjson, reflect) emit only one record
  // per line on stdout; consumers can sum severities themselves.
  if (format === 'human') {
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

/**
 * Read SQL from a readable stream up to `maxBytes`. Returns the
 * decoded UTF-8 string, or an error result when the size cap is
 * exceeded.
 *
 * Why inline (vs a dedicated module): the helper is small, used in
 * exactly one place, and pulling it into its own file would add an
 * import for ~15 lines of logic that has no other consumer. If a
 * future story needs to share it (e.g. a JS / API-shaped stdin
 * reader for the SDK side), promote then.
 *
 * Encoding: chunks are coerced to Buffer (in case the stream is in
 * string-decoder mode), accumulated, and decoded at the end. This
 * is one extra concat compared to decoding incrementally, but
 * incremental decoding would risk splitting a multi-byte UTF-8
 * sequence at a chunk boundary. The size cap means the buffer is
 * always ≤5 MB; the concat cost is bounded.
 */
async function readStdin(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<{ ok: true; sql: string } | { ok: false; error: string }> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk as Uint8Array);
    bytesRead += buf.length;
    if (bytesRead > maxBytes) {
      return {
        ok: false,
        error: `stdin size ${bytesRead} exceeds cap of ${maxBytes} bytes`,
      };
    }
    chunks.push(buf);
  }
  return { ok: true, sql: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Write a single catch to the output stream, branching on format.
 *
 * Human mode:   `formatCatch(c, file)` + a blank line for visual
 *               separation between catches (matches the established
 *               CLI shape).
 * JSONL mode:   `formatCatchJsonl(c, file)` + a single newline. One
 *               JSON object per line, no surrounding blank lines.
 * Reflect mode: `formatCatchReflect(c, file)` + a single newline. One
 *               reflection JSON object per line. EXPERIMENTAL schema.
 */
function writeCatch(
  out: NodeJS.WritableStream,
  c: import('../types.js').Catch,
  file: string,
  format: Format,
): void {
  if (format === 'jsonl') {
    out.write(formatCatchJsonl(c, file) + '\n');
  } else if (format === 'reflect') {
    out.write(formatCatchReflect(c, file) + '\n');
  } else {
    out.write(formatCatch(c, file) + '\n\n');
  }
}
