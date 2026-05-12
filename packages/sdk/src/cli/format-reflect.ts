// Experimental reflection-mode renderer for
// `vg-local analyze --reflect` (also: `--format=reflect`).
//
// Reflection mode emits one JSON object per catch designed to be fed
// into an agent's episodic-memory / lessons-learned layer. The shape
// adapts the SDK's already-existing catch fields to the salience-
// scoring language that's emerging in the agent-memory literature
// (pain_score, importance, suggested_lesson).
//
// EXPERIMENTAL status (V0):
//   The schema is `_schema: "vg-reflect/0"`. The `/0` is deliberate —
//   it signals that this schema is NOT under STABILITY.md semver
//   commitments. The next stable revision will be `vg-reflect/1`,
//   and the graduation criteria are documented in STABILITY.md:
//   "Reflection output schema (EXPERIMENTAL)" — broadly, ≥1 external
//   consumer + a 30-day field stability hold.
//
// Why no per-rule reflections in V0:
//   The default template synthesizes the `reflection` paragraph and
//   `suggested_lesson` one-liner from existing catch fields (title,
//   detail, fix, threatCategories, severity, confidence). No new data
//   structure is added to the rule definition. This keeps the
//   maintenance cost flat — adding a new catch does not require
//   writing a reflection paragraph. A future story (STORY-5.4)
//   introduces an optional per-rule override for catches where the
//   template is too generic; that override is purely additive.
//
// Privacy:
//   The `action` field is structural ("vibeguard catch SQL-NNN in
//   <file>[:line]") — it does NOT include raw SQL bytes. Reflection
//   output is intended to be appended to long-lived memory files;
//   leaking SQL into that surface would be a problem the SDK should
//   never cause. The catch's `code` + `file` is enough for the agent
//   to look back at the source if needed.

import type { Catch, Severity } from '../types.js';

/**
 * Stable schema-version tag for V0 (EXPERIMENTAL). Bumps to
 * `vg-reflect/1` when the schema graduates to stable under
 * STABILITY.md commitments. Consumers MUST branch on this — V0 and
 * V1 may differ structurally.
 */
export const REFLECT_SCHEMA_VERSION = 'vg-reflect/0';

/**
 * Constant skill identifier. Matches the `name:` frontmatter field in
 * `examples/agent-skill/SKILL.md`. Agents that ingest the reflection
 * stream and tag-by-skill can key on this string.
 */
export const REFLECT_SKILL_NAME = 'vibeguard-sql-safety';

/**
 * Severity → result mapping. Stable for V0.
 */
export type ReflectResult = 'blocked' | 'warned' | 'flagged';

/**
 * Render a single Catch as a one-line reflection JSON object.
 *
 * @param c - The catch to render.
 * @param filePath - File path relative to cwd. Forward-slash normalized.
 * @param now - Injected clock for deterministic tests. Defaults to
 *   `new Date()` at call time. Production code never passes this.
 * @returns A single line of valid JSON, no trailing newline.
 */
export function formatCatchReflect(
  c: Catch,
  filePath: string,
  now: Date = new Date(),
): string {
  const normalizedFile = normalizePath(filePath);
  const result = resultFor(c.severity);
  const pain = painScoreFor(c.severity);
  const importance = importanceFor(c.confidence);
  const action = buildAction(c, normalizedFile);
  const reflection = buildReflection(c);
  const suggested_lesson = buildSuggestedLesson(c);

  // Fixed key order matches the field table in STABILITY.md so two
  // runs over the same input produce byte-identical output (modulo
  // the timestamp, which the caller can pin via `now`).
  const obj: Record<string, unknown> = {
    _schema: REFLECT_SCHEMA_VERSION,
    timestamp: now.toISOString(),
    skill: REFLECT_SKILL_NAME,
    code: c.code,
    severity: c.severity,
    confidence: c.confidence,
    result,
    pain_score: pain,
    importance,
    threatCategories: c.threatCategories,
    file: normalizedFile,
    action,
    reflection,
    suggested_lesson,
  };
  if (c.location !== undefined) {
    obj['line'] = c.location.line;
    obj['column'] = c.location.column;
  }
  return JSON.stringify(obj);
}

/**
 * Severity → human-meaningful result string. "blocked" matches the
 * agent-memory literature's verb for "the action did not proceed."
 * "warned" / "flagged" similarly map to common memory-tier verbs.
 */
export function resultFor(severity: Severity): ReflectResult {
  if (severity === 'block') return 'blocked';
  if (severity === 'warn') return 'warned';
  return 'flagged';
}

/**
 * Severity → pain score (0–10). Mirrors the salience formula's "pain"
 * input. Block-severity catches are high pain; info catches are low.
 *
 * Specific values are deliberate: 9 / 5 / 2 leaves headroom for a
 * future tier above "block" (e.g. "incident") at 10, and a tier
 * below "info" at 0. Consumers should treat the values as an
 * ordinal ranking, not a linear scale.
 */
export function painScoreFor(severity: Severity): number {
  if (severity === 'block') return 9;
  if (severity === 'warn') return 5;
  return 2;
}

/**
 * Confidence (0–100) → importance (0–10). Linear, with rounding.
 * Clamped to [0, 10] defensively in case future Catch authors emit
 * out-of-range confidence values.
 */
export function importanceFor(confidence: number): number {
  const raw = Math.round(confidence / 10);
  // Use `<= 0` rather than `< 0` so that `Math.round(-0.5) === -0`
  // collapses to positive zero — JSON encoders preserve the sign of
  // negative zero, which would produce `"importance":-0` on the wire
  // for slightly-negative inputs.
  if (raw <= 0) return 0;
  if (raw > 10) return 10;
  return raw;
}

/**
 * Structural action string. NO raw SQL. The catch's code + file (+
 * optional line) is enough context for the agent to look back at the
 * source; including the SQL itself would risk leaking customer data
 * into long-lived memory files.
 */
function buildAction(c: Catch, normalizedFile: string): string {
  const where =
    c.location !== undefined
      ? `${normalizedFile}:${c.location.line}`
      : normalizedFile;
  return `vibeguard catch ${c.code} in ${where}`;
}

/**
 * Default reflection paragraph. Synthesized from existing catch
 * fields — no per-rule prose required. Rules whose default template
 * reads awkwardly can ship an optional override in a future story
 * (STORY-5.4); the override is purely additive.
 */
function buildReflection(c: Catch): string {
  const cats = c.threatCategories.join(', ');
  return (
    `${c.title} (${c.code}, severity=${c.severity}, confidence=${c.confidence}). ` +
    `${c.detail} ` +
    `Threat categories: ${cats}.`
  );
}

/**
 * Default suggested-lesson one-liner. Pulled from the catch's `fix`
 * field. The phrasing prepends "Before executing SQL that matches
 * <code> (<title>)" so the lesson is keyed on the stable catch
 * identifier, not just on a one-off prose description.
 */
function buildSuggestedLesson(c: Catch): string {
  return (
    `Before executing SQL that matches ${c.code} ("${c.title}"), ${c.fix}`
  );
}

/**
 * Same one-way separator normalization as format-jsonl.ts. We
 * deliberately do NOT share this helper across the two modules
 * (yet) — Epic 5 Story 5.1 set the precedent of keeping each format
 * module self-contained, and the helper is one line.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
