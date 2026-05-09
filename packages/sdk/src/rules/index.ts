// Rule registry.
//
// Each catch is one entry in this list. Order is significant: catches
// surface from runRules in registry order, and consumers that depend
// on deterministic output (CI snapshots, audit logs) rely on it.
//
// Catch IDs are forever-stable per STABILITY.md. Once a rule is in
// this registry under code SQL-NNN, that code always means the same
// threat shape across all future versions of @vibeguard-dev/local.
//
// V1.1 introduced metadata-bearing registry entries (RULE_REGISTRY)
// to support default-OFF rules. The legacy `RULES` export — the
// flat array of `Rule` functions that V1.0 advanced consumers use
// via `runRules(ast, RULES)` — is preserved with its V1.0 contract:
// it contains the default-enabled rules in registry order.
//
// Default-OFF rules (e.g. SQL-014) live in RULE_REGISTRY but NOT in
// RULES. Consumers opt them in via AnalyzeOptions.rules:
//
//   analyze(sql, { rules: { 'sql-014': { enabled: true } } })
//
// or by composing their own registry from RULE_REGISTRY:
//
//   const myRules = RULE_REGISTRY.map((e) => e.rule);
//   runRules(ast, myRules);

import type { Fixer, Rule } from '../types.js';
import { SQL_001, SQL_001_FIX } from './sql-001-cartesian.js';
import { SQL_002 } from './sql-002-self-join.js';
import { SQL_003 } from './sql-003-unbounded.js';
import { SQL_004 } from './sql-004-coercion.js';
import { SQL_005, SQL_005_FIX } from './sql-005-null-comparison.js';
import { SQL_006, SQL_006_FIX } from './sql-006-offset-without-orderby.js';
import { SQL_007 } from './sql-007-not-in-nullable.js';
import { SQL_008 } from './sql-008-string-concat.js';
import { SQL_009 } from './sql-009-distinct.js';
import { SQL_010 } from './sql-010-correlated-subquery.js';
import { SQL_011, SQL_011_FIX } from './sql-011-aggregate-no-groupby.js';
import { SQL_012 } from './sql-012-recursive-cte.js';
import { SQL_013 } from './sql-013-drop-truncate.js';
import { SQL_014 } from './sql-014-missing-returning.js';
import { SQL_015 } from './sql-015-select-star.js';
import { SQL_016 } from './sql-016-copy-program.js';
import { SQL_017 } from './sql-017-untrusted-extension.js';
import { SQL_018 } from './sql-018-drop-column.js';
import { SQL_019 } from './sql-019-create-trigger.js';
import { SQL_020 } from './sql-020-create-or-replace-function.js';
import { SQL_021 } from './sql-021-grant-public.js';
import { SQL_022 } from './sql-022-superuser-role.js';
import { SQL_023 } from './sql-023-pg-terminate-backend.js';
import { SQL_024 } from './sql-024-vacuum-full.js';
import { SQL_025 } from './sql-025-refresh-matview.js';
import { SQL_026 } from './sql-026-merge-tautology.js';
import { SQL_027 } from './sql-027-set-search-path.js';
import { SQL_028 } from './sql-028-replication-slot.js';
import { SQL_029 } from './sql-029-dblink-server.js';
import { SQL_030 } from './sql-030-file-primitives.js';
import { SQL_031 } from './sql-031-on-conflict-do-update.js';
import { SQL_032 } from './sql-032-explain-analyze-destructive.js';
import { SQL_033 } from './sql-033-do-block.js';
import { SQL_034 } from './sql-034-literal-tautology.js';
import { SQL_035 } from './sql-035-update-from-no-join.js';
import { SQL_036 } from './sql-036-delete-using-no-join.js';

/**
 * Metadata-bearing entry in the rule registry. Pairs a rule's
 * forever-stable code with the rule function itself, a flag
 * indicating whether the rule is enabled by default, and an
 * optional `fixer` for autofix support.
 *
 * `defaultEnabled: false` is reserved for rules that fire frequently
 * enough to be noisy when always-on, and where the consumer almost
 * always knows in advance whether they want the signal. SQL-014
 * (missing RETURNING) is the canonical example: useful when an
 * agent's prompts ask for the affected row back, noisy otherwise.
 *
 * `fixer` is present when V1.3+ added an autofix for the rule.
 * Currently: SQL-001 (placeholder JOIN with TODO predicate),
 * SQL-005 (= NULL → IS NULL), SQL-006 (insert ORDER BY 1),
 * SQL-011 (add missing GROUP BY column).
 */
export interface RuleEntry {
  readonly code: string;
  readonly rule: Rule;
  readonly defaultEnabled: boolean;
  readonly fixer?: Fixer;
  /**
   * Optional [min, max] confidence band the rule's catches fall in.
   * Documentation aid — consumers can use this to tune policy without
   * having to read each rule's docs. Rules with multiple confidence
   * tiers (e.g. SQL-008 emits 75 OR 85 depending on tier) declare the
   * full span here. Rules without this field have a single fixed
   * confidence documented in their per-rule docs.
   */
  readonly confidenceRange?: readonly [number, number];
}

/**
 * Full registry of all rules the SDK ships, in registry order.
 * Includes both default-on and default-off rules. The forever-stable
 * `code` is the source of truth for matching against
 * AnalyzeOptions.rules entries (case-insensitive).
 *
 * Adding an entry to this registry is a minor-version event;
 * removing one (or changing a `defaultEnabled` from true → false)
 * is a major-version event, per STABILITY.md.
 */
export const RULE_REGISTRY: readonly RuleEntry[] = [
  { code: 'SQL-001', rule: SQL_001, defaultEnabled: true, fixer: SQL_001_FIX },
  { code: 'SQL-002', rule: SQL_002, defaultEnabled: true },
  { code: 'SQL-003', rule: SQL_003, defaultEnabled: true },
  { code: 'SQL-004', rule: SQL_004, defaultEnabled: true },
  { code: 'SQL-005', rule: SQL_005, defaultEnabled: true, fixer: SQL_005_FIX },
  { code: 'SQL-006', rule: SQL_006, defaultEnabled: true, fixer: SQL_006_FIX },
  { code: 'SQL-007', rule: SQL_007, defaultEnabled: true },
  { code: 'SQL-008', rule: SQL_008, defaultEnabled: true, confidenceRange: [75, 90] },
  { code: 'SQL-009', rule: SQL_009, defaultEnabled: true },
  { code: 'SQL-010', rule: SQL_010, defaultEnabled: true },
  { code: 'SQL-011', rule: SQL_011, defaultEnabled: true, fixer: SQL_011_FIX },
  { code: 'SQL-012', rule: SQL_012, defaultEnabled: true },
  { code: 'SQL-013', rule: SQL_013, defaultEnabled: true },
  { code: 'SQL-014', rule: SQL_014, defaultEnabled: false }, // OPT-IN
  { code: 'SQL-015', rule: SQL_015, defaultEnabled: true },
  { code: 'SQL-016', rule: SQL_016, defaultEnabled: true },
  { code: 'SQL-017', rule: SQL_017, defaultEnabled: true },
  { code: 'SQL-018', rule: SQL_018, defaultEnabled: true },
  { code: 'SQL-019', rule: SQL_019, defaultEnabled: true },
  { code: 'SQL-020', rule: SQL_020, defaultEnabled: true },
  { code: 'SQL-021', rule: SQL_021, defaultEnabled: true },
  { code: 'SQL-022', rule: SQL_022, defaultEnabled: true },
  { code: 'SQL-023', rule: SQL_023, defaultEnabled: true },
  { code: 'SQL-024', rule: SQL_024, defaultEnabled: true },
  { code: 'SQL-025', rule: SQL_025, defaultEnabled: true },
  { code: 'SQL-026', rule: SQL_026, defaultEnabled: true },
  { code: 'SQL-027', rule: SQL_027, defaultEnabled: true },
  { code: 'SQL-028', rule: SQL_028, defaultEnabled: true },
  { code: 'SQL-029', rule: SQL_029, defaultEnabled: true },
  { code: 'SQL-030', rule: SQL_030, defaultEnabled: true },
  { code: 'SQL-031', rule: SQL_031, defaultEnabled: true },
  { code: 'SQL-032', rule: SQL_032, defaultEnabled: true },
  { code: 'SQL-033', rule: SQL_033, defaultEnabled: true },
  { code: 'SQL-034', rule: SQL_034, defaultEnabled: true },
  { code: 'SQL-035', rule: SQL_035, defaultEnabled: true },
  { code: 'SQL-036', rule: SQL_036, defaultEnabled: true },
] as const;

/**
 * Default-enabled rules in registry order. This is what
 * `analyze(sql)` runs by default, and what advanced consumers get
 * when they pass `RULES` to `runRules(ast, RULES)`.
 *
 * Backwards-compatible with V1.0: V1.0's RULES contained the 12
 * default-on rules of that release. V1.1 expands RULES to 14 by
 * adding the new default-on rules SQL-013 and SQL-015. SQL-014
 * is NOT in this list because it is opt-in.
 */
export const RULES: readonly Rule[] = RULE_REGISTRY
  .filter((entry) => entry.defaultEnabled)
  .map((entry) => entry.rule);
