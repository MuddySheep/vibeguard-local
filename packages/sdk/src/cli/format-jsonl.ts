// Machine-readable JSONL renderer for `vg-local analyze --format=jsonl`.
//
// Each call returns a single JSON-encoded line (no trailing newline —
// the caller is responsible for line termination). The output is
// stable per STABILITY.md "JSONL output schema":
//   - `_schema` is a literal version tag the consumer can branch on
//   - field removal / rename is a major-version event
//   - field addition is a minor-version event
//   - semantic change to an existing field is a major-version event
//
// `--format=ndjson` resolves to the same emitter; the names are aliases.
// NDJSON (newline-delimited JSON) and JSONL (JSON Lines) are the same
// format under two community names. We accept both at the flag layer
// and emit identical bytes.
//
// File-path normalization: paths are forward-slash-normalized so a
// Windows producer and a POSIX consumer see the same string. This
// matters for agent harnesses that key on path values.
//
// stdout is reserved for catch lines. Parse errors, fix-result
// summaries, and skip warnings stay on stderr as plain text. A
// consumer can rely on stdout being either empty or a stream of
// valid JSONL records — no human-text garnish.
//
// Dependency rule: this module imports only from `../types.js`. Pure,
// synchronous, side-effect-free.
//
// V1 schema (`_schema: "vg-jsonl/1"`):
//   _schema:           "vg-jsonl/1"        (constant)
//   code:              string              (catch ID, e.g. "SQL-001")
//   severity:          "block"|"warn"|"info"
//   confidence:        integer 0..100
//   title:             string
//   detail:            string
//   fix:               string
//   threatCategories:  string[]            (non-empty)
//   file:              string              (forward-slash normalized)
//   line:              integer (optional, present when Catch.location is set)
//   column:            integer (optional, present when Catch.location is set)

import type { Catch } from '../types.js';

/**
 * Stable schema version tag. Embedded as `_schema` on every emitted
 * line. Bumps on any major schema change (field removal/rename, type
 * change, semantic change). Additive changes do NOT bump this — they
 * are minor-version events per STABILITY.md and consumers ignore
 * unknown fields by convention.
 */
export const JSONL_SCHEMA_VERSION = 'vg-jsonl/1';

/**
 * Render a single Catch as one JSON-encoded line. No trailing newline.
 *
 * The output is deterministic: same input → same byte sequence. Field
 * order is fixed (matches the schema documentation in STABILITY.md)
 * so diffing two runs of the same input produces a clean visual diff.
 *
 * @param c - The catch to render.
 * @param filePath - The path of the file the catch came from, relative
 *   to the CLI's cwd. Forward-slash-normalized in the output.
 * @returns A single line of valid JSON, no terminating newline.
 */
export function formatCatchJsonl(c: Catch, filePath: string): string {
  const normalizedFile = normalizePath(filePath);

  // Build the object in a fixed key order. JSON.stringify on an object
  // literal in V8 (and every modern JS runtime we care about) preserves
  // insertion order for string keys, which gives us deterministic
  // output without a serializer detour.
  //
  // exactOptionalPropertyTypes-friendly: only spread the location keys
  // when location is actually set. No undefined-valued keys leak into
  // the output.
  const obj: Record<string, unknown> = {
    _schema: JSONL_SCHEMA_VERSION,
    code: c.code,
    severity: c.severity,
    confidence: c.confidence,
    title: c.title,
    detail: c.detail,
    fix: c.fix,
    threatCategories: c.threatCategories,
    file: normalizedFile,
  };
  if (c.location !== undefined) {
    obj['line'] = c.location.line;
    obj['column'] = c.location.column;
  }

  return JSON.stringify(obj);
}

/**
 * Normalize a file path to forward-slash form regardless of producer OS.
 *
 * Why this matters: an agent harness on Linux that consumes JSONL
 * produced on Windows should not have to deal with `\` separators.
 * The normalization is one-way (we never produce backslashes), and
 * does NOT resolve `..` or `.` segments — that's the caller's
 * concern. We only translate separators.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
