// Core public types for @vibeguard-dev/local.
//
// These types form the SDK's public type surface. STABILITY.md commits
// to keeping them stable post-1.0:
//   - Severity changes on existing catches are major-version events
//   - Confidence range adjustments are minor-version events
//   - Adding fields is a minor-version event; removing/renaming is major
//
// Keep this file dependency-free and side-effect-free. It is imported
// by every rule and by the public API; it must never reach for the
// parser, the registry, or anything async.

/**
 * Three-tier severity ladder. Consumers map severities to their own
 * action policies; the SDK does not enforce a workflow.
 *
 * - `block` — pattern is dangerous in essentially all contexts (e.g.
 *   cartesian explosion, unbounded UPDATE/DELETE)
 * - `warn` — pattern is suspicious or context-dependent (e.g. NULL
 *   comparison, OFFSET without ORDER BY)
 * - `info` — pattern is worth noting but rarely a blocker (used
 *   sparingly; e.g. DISTINCT without obvious reduction)
 */
export type Severity = 'block' | 'warn' | 'info';

/**
 * Closed set of threat categorizations. Catches tag themselves with
 * one or more of these so consumers can build policy around category,
 * not just severity. Adding a new category is a minor-version event.
 *
 * - `destruction` — write paths that affect more rows than intended
 *   (unbounded UPDATE/DELETE, recursive CTE)
 * - `exfiltration` — read paths that surface more data than intended
 * - `injection` — string-construction patterns that look like SQL
 *   injection
 * - `denial-of-service` — query shapes that exhaust resources
 *   (cartesian explosion, runaway recursion)
 * - `corruption` — semantic bugs that yield wrong results without
 *   throwing (NULL comparison footguns, type coercion)
 * - `integrity` — query shapes whose output the caller probably
 *   misinterprets (DISTINCT, aggregate without GROUP BY)
 */
export type ThreatCategory =
  | 'destruction'
  | 'exfiltration'
  | 'injection'
  | 'denial-of-service'
  | 'corruption'
  | 'integrity';

/**
 * A single firing of a static-analysis catch.
 *
 * Catch IDs (`code`) are forever-stable per STABILITY.md: once `SQL-003`
 * ships in a public release, that ID always means the same threat shape.
 * Customers can write `if (catch.code === 'SQL-003')` and rely on it.
 */
export interface Catch {
  /** Stable forever-ID, e.g. "SQL-001". Never reused. */
  readonly code: string;
  /** Human-readable title in present tense, e.g. "Cartesian explosion risk". */
  readonly title: string;
  /** Three-tier severity ladder. */
  readonly severity: Severity;
  /** Detection certainty, 0-100. Rule author's call; documented per rule. */
  readonly confidence: number;
  /** Plain-English explanation of what fired and why it matters. */
  readonly detail: string;
  /** Plain-English fix suggestion the LLM (or human) can act on. */
  readonly fix: string;
  /** Categorization for downstream policy mapping. */
  readonly threatCategories: readonly ThreatCategory[];
  /**
   * Optional pointer into the source SQL — line/col for IDE
   * integrations. Rules populate this when they can; consumers must
   * tolerate its absence.
   */
  readonly location?: { readonly line: number; readonly column: number };
}

/**
 * Structured parse-failure information. Returned in `AnalysisResult.parseError`
 * when the SDK's parser wrapper could not parse the input. The catch
 * array will be empty in that case (no AST to analyze).
 */
export interface ParseError {
  /** libpg-query error message, lightly normalized. */
  readonly message: string;
  /**
   * Cursor position (zero-based byte offset into the input) where
   * libpg-query reported the failure. Optional because not all
   * failure modes carry positional info.
   */
  readonly cursor?: number;
}

/**
 * Result returned by the public `analyze()` function. Throw-safe by
 * contract: `analyze` does not throw on adversarial input — it returns
 * a result whose `parseError` is populated and whose `catches` array
 * is empty.
 */
export interface AnalysisResult {
  /** All catches that fired against the input, in registry order. */
  readonly catches: readonly Catch[];
  /** Populated iff parsing failed; `catches` is empty in that case. */
  readonly parseError?: ParseError;
}

/**
 * A single static-analysis rule. Pure function from a parsed AST to
 * either a `Catch` (the rule fired) or `null` (the rule did not fire).
 *
 * Rules are deliberately typed loose at the public boundary: the AST
 * is `unknown` because libpg-query's exact shape can drift across
 * parser-version updates, and we don't want every parser bump to be
 * a major-version event of this SDK. Each rule narrows internally as
 * it walks the AST. See ARCHITECTURE.md for the rationale.
 */
export type Rule = (ast: unknown) => Catch | null;

/**
 * A single autofix for a rule. Applies ONE fix per call (matching
 * ESLint's contract); the fix-runner iterates until stable.
 *
 * Receives both the parsed AST (for navigation) and the original SQL
 * string (for source-text surgery). Returns the modified SQL with
 * one occurrence of the catch's pattern fixed, or `null` if the
 * fixer can't safely fix this AST shape.
 *
 * Source-text manipulation is deliberate: AST→SQL deparse loses
 * whitespace, comments, and quoting style, all of which matter to
 * a developer reading their own code. Fixers use the AST to confirm
 * whether the catch is real and to find the relevant nodes; the
 * actual edit is applied to the source string.
 *
 * Stability commitment (V1.3+): adding a fixer to an existing rule
 * is a minor-version event; removing one is major. The shape of the
 * Fixer type is part of the public API surface.
 */
export interface Fixer {
  /**
   * Apply at most one fix to the SQL string. Returns the modified
   * SQL or `null` if no fix can be applied.
   *
   * Implementations MUST NOT throw on adversarial input; on any
   * unexpected AST shape, return `null` and let the rule keep
   * surfacing the catch unchanged.
   */
  fix(ast: unknown, sql: string): string | null;
}
