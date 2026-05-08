// SQL-013 — Destructive DDL (DROP / TRUNCATE).
//
// Severity:    block (confidence 99) for the destructive variants
//              warn  (confidence 85) for DROP INDEX
// Threat:      destruction
//
// Pattern:
//   - DropStmt with removeType in
//       { OBJECT_TABLE, OBJECT_SCHEMA, OBJECT_INDEX }
//   - DropdbStmt (any — DROP DATABASE has no per-target qualifier)
//   - TruncateStmt (any — TRUNCATE is unambiguously destructive)
//
// Distinct from SQL-003 (which catches unbounded UPDATE/DELETE — DML).
// DDL has no WHERE clause possibility, so the verdict is unambiguous:
// the statement either runs and destroys the named object(s), or it
// doesn't. There is no scope to add to soften the operation in place.
//
// Why DROP INDEX is warn, not block:
//   Operators legitimately drop indexes during schema maintenance
//   (replacing with a better index, dropping unused ones to free
//   write capacity). The shape of the threat is a downgrade from a
//   table-/database-/schema-drop, hence warn at lower confidence.
//
// Out of scope (deliberately, for V1.1):
//   - DROP VIEW, DROP FUNCTION, DROP SEQUENCE, DROP TYPE — these are
//     legitimate maintenance operations more often than not.
//   - ALTER TABLE ... DROP COLUMN — different statement (AlterTableStmt
//     with subtype AT_DropColumn). Its own catch if we add it later.
//   - Permission DROPs (DROP USER / DROP ROLE) — out of the SQL-* SDK
//     scope; permissions live in the cloud product.
//
// Multi-target DROPs (e.g. `DROP TABLE a, b, c`):
//   The catch fires once with all names listed in the detail. The
//   rule contract is `(ast) => Catch | null` — single fire — so we
//   collect every dropped target's name and report them together.
//
// Multi-statement scripts (e.g. `DROP TABLE a; DROP TABLE b;`):
//   Same approach. We walk the WHOLE AST, collect every destructive
//   DDL we find, and surface them in one Catch. The title gets a
//   `× N` count suffix when more than one destructive statement
//   is present so the developer doesn't think only the first was
//   detected. INDEX and destructive variants are kept separate —
//   the first destructive (block) variant takes priority; trailing
//   INDEX drops are still mentioned in the detail.

import { astWalk } from '../ast-walk.js';
import type { Catch, Rule } from '../types.js';

interface DropTarget {
  readonly kind:
    | 'TABLE'
    | 'DATABASE'
    | 'SCHEMA'
    | 'INDEX'
    | 'TRUNCATE';
  /** Names of the dropped/truncated objects, in source order. */
  readonly names: readonly string[];
  /** True when the underlying SQL was a CASCADE drop. */
  readonly cascade: boolean;
}

export const SQL_013: Rule = (ast) => {
  const targets: DropTarget[] = [];

  astWalk(ast, (node) => {
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;

    if ('DropStmt' in obj) {
      const stmt = obj['DropStmt'] as Record<string, unknown>;
      const removeType = stmt['removeType'];
      const behavior = stmt['behavior'];
      const cascade = behavior === 'DROP_CASCADE';
      const objects = stmt['objects'];

      if (removeType === 'OBJECT_TABLE') {
        targets.push({
          kind: 'TABLE',
          names: extractObjectNames(objects),
          cascade,
        });
        return undefined;
      }
      if (removeType === 'OBJECT_SCHEMA') {
        targets.push({
          kind: 'SCHEMA',
          names: extractObjectNames(objects),
          cascade,
        });
        return undefined;
      }
      if (removeType === 'OBJECT_INDEX') {
        targets.push({
          kind: 'INDEX',
          names: extractObjectNames(objects),
          cascade,
        });
        return undefined;
      }
      // Other DropStmt removeTypes (VIEW, FUNCTION, SEQUENCE, TYPE,
      // …) intentionally fall through — out of V1.1 scope.
      return undefined;
    }

    if ('DropdbStmt' in obj) {
      const stmt = obj['DropdbStmt'] as Record<string, unknown>;
      const dbname =
        typeof stmt['dbname'] === 'string' ? stmt['dbname'] : '<unknown>';
      targets.push({
        kind: 'DATABASE',
        names: [dbname],
        cascade: false,
      });
      return undefined;
    }

    if ('TruncateStmt' in obj) {
      const stmt = obj['TruncateStmt'] as Record<string, unknown>;
      targets.push({
        kind: 'TRUNCATE',
        names: extractTruncateRelations(stmt['relations']),
        cascade: stmt['behavior'] === 'DROP_CASCADE',
      });
      return undefined;
    }

    return undefined;
  });

  if (targets.length === 0) return null;

  // Pick a primary target: first destructive (block) variant if any,
  // otherwise the first INDEX. The remaining targets are still surfaced
  // in the detail so a multi-statement script doesn't look like only
  // one statement was reviewed.
  const firstDestructive = targets.find((x) => x.kind !== 'INDEX');
  const t: DropTarget = firstDestructive ?? (targets[0] as DropTarget);
  const totalCount = targets.length;
  const otherTargets = targets.filter((x) => x !== t);

  // DROP INDEX is the only soft case — operators sometimes drop
  // indexes intentionally during maintenance.
  if (t.kind === 'INDEX') {
    const countSuffix = totalCount > 1 ? ` × ${totalCount}` : '';
    const additional = formatAdditional(otherTargets);
    const result: Catch = {
      code: 'SQL-013',
      title: `DROP INDEX${countSuffix}`,
      severity: 'warn',
      confidence: 85,
      detail:
        `DROP INDEX targets [${formatNames(t.names)}]. Index drops are ` +
        `sometimes legitimate maintenance, but more often they are ` +
        `agent-generated mistakes that silently degrade query ` +
        `performance — Postgres does not warn when an indexed ` +
        `predicate falls back to a sequential scan.` +
        additional,
      fix:
        `Verify the drop is intended. If you're replacing an index, ` +
        `consider CREATE INDEX CONCURRENTLY for the replacement ` +
        `before dropping the old one. If you're freeing write ` +
        `capacity, log the drop in a migration record so you can ` +
        `restore it later.`,
      threatCategories: ['destruction'],
    };
    return result;
  }

  // DROP TABLE / DROP DATABASE / DROP SCHEMA / TRUNCATE — block.
  const verb = describeKind(t.kind);
  const cascadeNote = t.cascade
    ? ' Combined with CASCADE, this also drops every dependent object (foreign keys, views, functions) without further prompting.'
    : '';
  const countSuffix = totalCount > 1 ? ` × ${totalCount}` : '';
  const additional = formatAdditional(otherTargets);
  const result: Catch = {
    code: 'SQL-013',
    title: `${titleFor(t.kind)}${countSuffix}`,
    severity: 'block',
    confidence: 99,
    detail:
      `${verb} on [${formatNames(t.names)}] is irreversible.${cascadeNote} ` +
      `In an AI-agent context this is essentially never the intended ` +
      `operation — the agent's plan almost certainly meant to remove ` +
      `specific rows, not the entire object.` +
      additional,
    fix:
      `Verify the destruction is intended and use a migration tool ` +
      `with a confirmation step. Consider RENAME TABLE ... TO ` +
      `__soft_deleted_<n> as a reversible alternative — it lets you ` +
      `re-validate the agent's plan against real data before the ` +
      `original is unrecoverable.`,
    threatCategories: ['destruction'],
  };
  return result;
};

function describeKind(kind: DropTarget['kind']): string {
  switch (kind) {
    case 'TABLE':
      return 'DROP TABLE';
    case 'DATABASE':
      return 'DROP DATABASE';
    case 'SCHEMA':
      return 'DROP SCHEMA';
    case 'TRUNCATE':
      return 'TRUNCATE';
    case 'INDEX':
      return 'DROP INDEX';
  }
}

function titleFor(kind: DropTarget['kind']): string {
  switch (kind) {
    case 'TABLE':
      return 'DROP TABLE — irreversible table destruction';
    case 'DATABASE':
      return 'DROP DATABASE — irreversible database destruction';
    case 'SCHEMA':
      return 'DROP SCHEMA — irreversible schema destruction';
    case 'TRUNCATE':
      return 'TRUNCATE — non-recoverable bulk row deletion';
    case 'INDEX':
      return 'DROP INDEX';
  }
}

function formatNames(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : '<unknown>';
}

/**
 * When a multi-statement script contains more than one destructive
 * DDL, append a "Additional destructive statements" footer to the
 * detail so the developer sees every statement, not just the first.
 */
function formatAdditional(others: readonly DropTarget[]): string {
  if (others.length === 0) return '';
  const lines = others.map(
    (o) => `  - ${describeKind(o.kind)} [${formatNames(o.names)}]`,
  );
  return (
    `\n\nAdditional destructive statements in this script ` +
    `(${others.length}):\n${lines.join('\n')}`
  );
}

/**
 * DropStmt.objects shape varies by removeType:
 *   - TABLE / INDEX: each entry is { List: { items: [{ String: { sval } }, ...] } }
 *     The items array is the dotted name (e.g. ['public', 'users']).
 *   - SCHEMA: each entry is { String: { sval } } directly (no List wrapper).
 *
 * We unify both shapes here.
 */
function extractObjectNames(objects: unknown): readonly string[] {
  if (!Array.isArray(objects)) return [];
  const out: string[] = [];
  for (const entry of objects) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    // TABLE / INDEX shape: { List: { items: [...] } }
    if ('List' in e) {
      const list = e['List'] as Record<string, unknown>;
      const items = list?.['items'];
      if (Array.isArray(items)) {
        const parts: string[] = [];
        for (const item of items) {
          const s = readStringSval(item);
          if (s !== null) parts.push(s);
        }
        if (parts.length > 0) out.push(parts.join('.'));
      }
      continue;
    }

    // SCHEMA shape: { String: { sval } }
    const s = readStringSval(entry);
    if (s !== null) out.push(s);
  }
  return out;
}

/**
 * TruncateStmt.relations is an array of { RangeVar: { relname, schemaname? } }.
 * Returns the dotted form schema.relname (or just relname).
 */
function extractTruncateRelations(relations: unknown): readonly string[] {
  if (!Array.isArray(relations)) return [];
  const out: string[] = [];
  for (const entry of relations) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!('RangeVar' in e)) continue;
    const rv = e['RangeVar'] as Record<string, unknown>;
    const relname = typeof rv['relname'] === 'string' ? rv['relname'] : '';
    const schemaname =
      typeof rv['schemaname'] === 'string' ? `${rv['schemaname']}.` : '';
    if (relname) out.push(`${schemaname}${relname}`);
  }
  return out;
}

function readStringSval(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  if (!('String' in n)) return null;
  const s = n['String'] as Record<string, unknown>;
  return typeof s['sval'] === 'string' ? s['sval'] : null;
}
