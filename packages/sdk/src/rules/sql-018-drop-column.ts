// SQL-018 — ALTER TABLE ... DROP COLUMN.
  //
  // Severity:    warn (confidence 90)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   AlterTableStmt whose `cmds` array contains an AlterTableCmd
  //   with subtype === 'AT_DropColumn'. The column name lives in
  //   the cmd's `name` field; CASCADE behavior is encoded as
  //   behavior === 'DROP_CASCADE'.
  //
  // Why warn (not block): operators legitimately drop columns during
  // schema cleanup. The threat is real (data is unrecoverable, and
  // cached query plans / downstream readers break) but the operation
  // is not as one-shot-disastrous as a DROP TABLE.
  //
  // Why 90 confidence: the AST signal is unambiguous (AT_DropColumn is
  // a single subtype). The 10 points of slack are for the legitimate-
  // maintenance case.
  //
  // Multi-cmd ALTER TABLEs (`ALTER TABLE t DROP COLUMN a, DROP COLUMN b`)
  // fire once with all dropped column names listed in the detail.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';

  interface DropColumnInfo {
    readonly relname: string;
    readonly columns: readonly string[];
    readonly cascade: boolean;
  }

  export const SQL_018: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['AlterTableStmt']))) return null;
    let fired: DropColumnInfo | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      if (!('AlterTableStmt' in obj)) return undefined;
      const stmt = obj['AlterTableStmt'] as Record<string, unknown>;
      const cmds = stmt['cmds'];
      if (!Array.isArray(cmds)) return undefined;
      const drops: string[] = [];
      let cascade = false;
      for (const c of cmds) {
        if (!c || typeof c !== 'object') continue;
        const co = c as Record<string, unknown>;
        if (!('AlterTableCmd' in co)) continue;
        const cmd = co['AlterTableCmd'] as Record<string, unknown>;
        if (cmd['subtype'] !== 'AT_DropColumn') continue;
        const cname = typeof cmd['name'] === 'string' ? cmd['name'] : '<unknown>';
        drops.push(cname);
        if (cmd['behavior'] === 'DROP_CASCADE') cascade = true;
      }
      if (drops.length === 0) return undefined;
      const rel = stmt['relation'] as Record<string, unknown> | undefined;
      fired = {
        relname: typeof rel?.['relname'] === 'string' ? (rel['relname'] as string) : '<unknown>',
        columns: drops,
        cascade,
      };
      return 'stop';
    });
    if (!fired) return null;
    const f: DropColumnInfo = fired;
    const cascadeNote = f.cascade
      ? ' Combined with CASCADE, this also drops any view, index, or constraint that references the column.'
      : '';
    const result: Catch = {
      code: 'SQL-018',
      title:
        f.columns.length === 1
          ? `ALTER TABLE DROP COLUMN — irreversible schema change`
          : `ALTER TABLE DROP COLUMN × ${f.columns.length} — irreversible schema change`,
      severity: 'warn',
      confidence: 90,
      detail:
        `ALTER TABLE ${f.relname} DROP COLUMN [${f.columns.join(', ')}] is ` +
        `irreversible. The column data cannot be recovered without a ` +
        `backup, and any downstream reader (other services, materialized ` +
        `views, cached query plans) breaks the next time it touches the ` +
        `column.${cascadeNote}`,
      fix:
        `If the column is genuinely unused, route the drop through a ` +
        `migration tool with a reversible step. As an interim, RENAME ` +
        `the column (e.g. \`ALTER TABLE ${f.relname} RENAME COLUMN ` +
        `${f.columns[0] ?? '<col>'} TO __deprecated_${f.columns[0] ?? '<col>'}\`) — ` +
        `reads of the new name fail loudly while the data remains ` +
        `available for rollback.`,
      threatCategories: ['destruction'],
    };
    return result;
  };
  