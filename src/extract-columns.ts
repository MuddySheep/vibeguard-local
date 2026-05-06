// Extract ColumnRef references from any statement / sub-tree.
//
// libpg-query represents column references as ColumnRef nodes whose
// `fields` array holds the dotted-name components: `t.col` becomes
// `[String{sval: "t"}, String{sval: "col"}]`. Star references like
// `*` and `t.*` use `A_Star` as the final field instead of String.
//
// We split fields into table + name with the convention:
//   - 1 field: `name = field0`, no table
//   - 2 fields: `table = field0`, `name = field1`
//   - 3+ fields: `schema = field0`, `table = field1`, `name = lastField`
//     (a 4th-or-deeper component shouldn't happen in real SQL; if it
//     does, we fold extras into `table` to preserve information)
//
// For star: `name = '*'` (sentinel string).

import { astWalk } from './ast-walk.js';

/**
 * One column reference pulled from a statement.
 */
export interface ColumnRef {
  /** Bare column name, or `'*'` for a star reference. */
  readonly name: string;
  /** Table or alias qualifier if present (`u` in `u.id`). */
  readonly table?: string;
  /** Schema qualifier if present (`public` in `public.users.id`). */
  readonly schema?: string;
}

interface ColumnRefNodeLike {
  readonly fields?: readonly unknown[];
}

interface StringFieldLike {
  readonly String?: { readonly sval?: string };
}

interface AStarFieldLike {
  readonly A_Star?: Record<string, unknown>;
}

/**
 * Walk the supplied node and yield every ColumnRef reachable from it.
 *
 * Yields one entry per ColumnRef in source order. Duplicates are
 * preserved (caller can dedupe if needed).
 *
 * Tolerant of malformed or partial AST shapes: a ColumnRef with no
 * fields is skipped; a field that's neither String nor A_Star is
 * folded into the name as a fallback (defensive — should not happen
 * with real libpg-query output).
 */
export function extractColumns(stmt: unknown): ColumnRef[] {
  const cols: ColumnRef[] = [];

  astWalk(stmt, (node) => {
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    if (!('ColumnRef' in obj)) return undefined;

    const cr = obj['ColumnRef'] as ColumnRefNodeLike;
    if (!Array.isArray(cr.fields) || cr.fields.length === 0) return undefined;

    const parts = cr.fields.map(fieldToString);

    // Last field is always the column name (or '*' if A_Star).
    const last = parts[parts.length - 1] ?? '';
    let table: string | undefined;
    let schema: string | undefined;

    if (parts.length === 2) {
      table = parts[0] ?? undefined;
    } else if (parts.length === 3) {
      schema = parts[0] ?? undefined;
      table = parts[1] ?? undefined;
    } else if (parts.length > 3) {
      // Defensive: fold all-but-last into a dotted table string.
      schema = parts[0] ?? undefined;
      table = parts.slice(1, -1).join('.');
    }

    const entry: ColumnRef = {
      name: last,
      ...(table !== undefined ? { table } : {}),
      ...(schema !== undefined ? { schema } : {}),
    };
    cols.push(entry);

    // Skip descending into the ColumnRef's own children — they're
    // just the field strings we already extracted.
    return 'skip';
  });

  return cols;
}

function fieldToString(field: unknown): string {
  if (field && typeof field === 'object') {
    const f = field as StringFieldLike & AStarFieldLike;
    if (f.String && typeof f.String.sval === 'string') {
      return f.String.sval;
    }
    if (f.A_Star) {
      return '*';
    }
  }
  // Defensive fallback for shapes we don't recognize.
  return '';
}
