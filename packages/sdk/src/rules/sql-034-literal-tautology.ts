// SQL-034 — literal tautology in WHERE on UPDATE/DELETE.
  //
  // Severity:    block (confidence 95)
  // Threat:      destruction
  // Default:     ON
  // Stable since: 1.1.0
  //
  // Pattern:
  //   UpdateStmt or DeleteStmt whose whereClause reduces to a literal
  //   tautology (`1=1`, `true`, `'a'='a'`, `id = id`, `NOT false`).
  //
  // A tautological WHERE matches every row — so an UPDATE/DELETE with
  // such a WHERE is a full-table mutation in disguise. SQL-001 and
  // SQL-003 catch UPDATE/DELETE with NO WHERE; this rule catches the
  // nearby variant where the agent added a WHERE to satisfy the
  // missing-WHERE check but the WHERE is meaningless.
  //
  // Why block / 95: the AST signal is unambiguous (a literal
  // tautology resolves to TRUE without reading any column value). The
  // 5 points of slack reflect the (rare) legitimate seed-data case
  // where an operator deliberately writes `UPDATE feature_flags SET
  // active = true WHERE 1=1` as an idiom.
  //
  // CRITICAL: must NOT fire when the tautology is one branch of an
  // AND/OR with a real predicate (`WHERE 1=1 AND id = 42` is a real
  // query). The shared isLiteralTautology helper deliberately does
  // not recurse into BoolExpr AND/OR for this reason.

  import { astWalk } from '../ast-walk.js';
import { hasTopLevelStmt } from './stmt-dispatch.js';
  import type { Catch, Rule } from '../types.js';
  import { isLiteralTautology } from './is-tautology.js';

  export const SQL_034: Rule = (ast) => {
  if (!hasTopLevelStmt(ast, new Set(['UpdateStmt', 'DeleteStmt']))) return null;
    let fired: 'UPDATE' | 'DELETE' | null = null;
    astWalk(ast, (node) => {
      if (fired) return 'stop';
      if (!node || typeof node !== 'object') return undefined;
      const obj = node as Record<string, unknown>;
      let whereClause: unknown = undefined;
      let verb: 'UPDATE' | 'DELETE' | null = null;
      if ('UpdateStmt' in obj) {
        const stmt = obj['UpdateStmt'] as Record<string, unknown>;
        whereClause = stmt['whereClause'];
        verb = 'UPDATE';
      } else if ('DeleteStmt' in obj) {
        const stmt = obj['DeleteStmt'] as Record<string, unknown>;
        whereClause = stmt['whereClause'];
        verb = 'DELETE';
      } else {
        return undefined;
      }
      if (whereClause === undefined || whereClause === null) return undefined;
      if (!isLiteralTautology(whereClause)) return undefined;
      fired = verb;
      return 'stop';
    });
    if (!fired) return null;
    const verb: 'UPDATE' | 'DELETE' = fired;
    const result: Catch = {
      code: 'SQL-034',
      title: `${verb} WHERE <tautology> — full-table mutation in disguise`,
      severity: 'block',
      confidence: 95,
      detail:
        `The WHERE clause on this ${verb} reduces to a literal tautology ` +
        `(\`1=1\`, \`true\`, \`'a'='a'\`, \`id = id\`, or similar). It ` +
        `evaluates TRUE without reading any column value, so the ${verb} ` +
        `affects every row in the target table — a full-table mutation ` +
        `expressed in syntax that satisfies the "must have a WHERE" ` +
        `check.`,
      fix:
        `Replace the tautology with a WHERE clause that identifies the ` +
        `rows you intend to mutate (e.g. \`WHERE id = ?\`, \`WHERE ` +
        `updated_at < now() - interval '7 days'\`). If you genuinely ` +
        `intend a full-table mutation, route it through an explicit ` +
        `migration step that operators can review.`,
      threatCategories: ['destruction'],
    };
    return result;
  };
  