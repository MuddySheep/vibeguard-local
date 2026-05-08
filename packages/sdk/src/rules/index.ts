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

import type { Rule } from '../types.js';
import { SQL_001 } from './sql-001-cartesian.js';
import { SQL_002 } from './sql-002-self-join.js';
import { SQL_003 } from './sql-003-unbounded.js';
import { SQL_004 } from './sql-004-coercion.js';
import { SQL_005 } from './sql-005-null-comparison.js';
import { SQL_006 } from './sql-006-offset-without-orderby.js';
import { SQL_007 } from './sql-007-not-in-nullable.js';
import { SQL_008 } from './sql-008-string-concat.js';
import { SQL_009 } from './sql-009-distinct.js';
import { SQL_010 } from './sql-010-correlated-subquery.js';
import { SQL_011 } from './sql-011-aggregate-no-groupby.js';
import { SQL_012 } from './sql-012-recursive-cte.js';
import { SQL_013 } from './sql-013-drop-truncate.js';
import { SQL_014 } from './sql-014-missing-returning.js';
import { SQL_015 } from './sql-015-select-star.js';

/**
 * Metadata-bearing entry in the rule registry. Pairs a rule's
 * forever-stable code with the rule function itself and a flag
 * indicating whether the rule is enabled by default.
 *
 * `defaultEnabled: false` is reserved for rules that fire frequently
 * enough to be noisy when always-on, and where the consumer almost
 * always knows in advance whether they want the signal. SQL-014
 * (missing RETURNING) is the canonical example: useful when an
 * agent's prompts ask for the affected row back, noisy otherwise.
 */
export interface RuleEntry {
  readonly code: string;
  readonly rule: Rule;
  readonly defaultEnabled: boolean;
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
  { code: 'SQL-001', rule: SQL_001, defaultEnabled: true },
  { code: 'SQL-002', rule: SQL_002, defaultEnabled: true },
  { code: 'SQL-003', rule: SQL_003, defaultEnabled: true },
  { code: 'SQL-004', rule: SQL_004, defaultEnabled: true },
  { code: 'SQL-005', rule: SQL_005, defaultEnabled: true },
  { code: 'SQL-006', rule: SQL_006, defaultEnabled: true },
  { code: 'SQL-007', rule: SQL_007, defaultEnabled: true },
  { code: 'SQL-008', rule: SQL_008, defaultEnabled: true },
  { code: 'SQL-009', rule: SQL_009, defaultEnabled: true },
  { code: 'SQL-010', rule: SQL_010, defaultEnabled: true },
  { code: 'SQL-011', rule: SQL_011, defaultEnabled: true },
  { code: 'SQL-012', rule: SQL_012, defaultEnabled: true },
  { code: 'SQL-013', rule: SQL_013, defaultEnabled: true },
  { code: 'SQL-014', rule: SQL_014, defaultEnabled: false }, // OPT-IN
  { code: 'SQL-015', rule: SQL_015, defaultEnabled: true },
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
