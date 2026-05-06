// Rule registry.
//
// Each catch is one entry in this list. Order is significant only in
// that `runRules` returns catches in registry order; downstream
// consumers that care about deterministic output order should rely
// on this. Adding a new catch is a single-line change here, mirroring
// the proposal-and-implement workflow in CONTRIBUTING.md.
//
// Catch IDs are forever-stable per STABILITY.md. Once a rule is in
// this registry under code SQL-NNN, that code always means the same
// threat shape across all future versions of @vibeguard-dev/local.

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

// Rules listed in ascending numeric-ID order. Twelve catches total —
// the SDK's complete 1.0 detection set.
export const RULES: readonly Rule[] = [
  SQL_001,
  SQL_002,
  SQL_003,
  SQL_004,
  SQL_005,
  SQL_006,
  SQL_007,
  SQL_008,
  SQL_009,
  SQL_010,
  SQL_011,
  SQL_012,
] as const;
