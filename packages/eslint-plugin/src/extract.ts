// Extract a SQL string + placeholder mapping from an ESTree
// TemplateLiteral.
//
// The plugin's rule visits TaggedTemplateExpression nodes (sql`...`)
// and CallExpression nodes whose first arg is a TemplateLiteral
// (db.query(`...`)). Both share the same TemplateLiteral payload, so
// the extraction logic lives here and is invoked from either visitor.
//
// Output: a SQL string the analyzer can parse, plus a mapping from
// each `$N` placeholder back to the source text of the original
// `${expr}` it stood in for. The reconstruction step (used during
// autofix) needs the mapping to re-inline the original expressions
// when emitting the fixed template literal.
//
// Why `$N` rather than `?` placeholders:
//   `$1`, `$2`, ... is Postgres's native parameter syntax. libpg-query
//   parses it cleanly as ParamRef nodes, the analyzer's rules ignore
//   ParamRef nodes (they're not literals), and the runner's fixers
//   never touch them. So the placeholders survive verbatim through
//   any fix the runner applies, and reconstruction is a simple
//   string replacement.

import type { TemplateLiteral } from 'estree';

export interface ExtractedSql {
  /** SQL string with `${expr}` segments replaced by `$1`, `$2`, ... */
  readonly sql: string;
  /**
   * Mapping from placeholder name (`$1`, `$2`, ...) to the source
   * text of the original expression it stood in for. Keys are in the
   * same order as the template's `expressions` array.
   */
  readonly mapping: ReadonlyMap<string, string>;
}

/**
 * Walk a TemplateLiteral and produce a parser-friendly SQL string
 * with `$N` placeholders for each `${expr}` substitution.
 *
 * @param template - the TemplateLiteral AST node
 * @param getExpressionSource - function that returns the source-text
 *   of an expression node. The plugin passes
 *   `(node) => sourceCode.getText(node)`.
 */
export function extractSql(
  template: TemplateLiteral,
  getExpressionSource: (node: TemplateLiteral['expressions'][number]) => string,
): ExtractedSql {
  let sql = '';
  const mapping = new Map<string, string>();

  // A TemplateLiteral has N+1 quasis and N expressions interleaved.
  // The structure is:
  //   `<q0>${e0}<q1>${e1}<q2>...${eN-1}<qN>`
  for (let i = 0; i < template.quasis.length; i++) {
    const quasi = template.quasis[i];
    if (!quasi) continue;
    sql += quasi.value.cooked ?? quasi.value.raw;
    if (i < template.expressions.length) {
      const param = `$${i + 1}`;
      sql += param;
      const expr = template.expressions[i];
      if (expr) {
        mapping.set(param, getExpressionSource(expr));
      }
    }
  }

  return { sql, mapping };
}

/**
 * Configuration for which call-expression callees should have their
 * first argument extracted as SQL. The matcher accepts both bare
 * function names (`query`, `raw`) and member expressions
 * (`db.query`, `pool.query`, `client.unsafe`). Member expressions
 * match against the dotted form.
 */
export interface CallExpressionMatcher {
  /** Function/member-expression names to match. */
  readonly callExpressions: readonly string[];
}

/**
 * Best-effort name extraction for a call-expression callee.
 * Returns null if the callee shape doesn't fit a configurable pattern
 * (e.g. dynamic dispatch like `methodMap[name]()`).
 */
export function getCalleeName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type: string };

  if (n.type === 'Identifier') {
    return (n as unknown as { name: string }).name;
  }
  if (n.type === 'MemberExpression') {
    const m = n as unknown as {
      object: { type: string; name?: string };
      property: { type: string; name?: string };
      computed: boolean;
    };
    if (m.computed) return null;
    if (m.property.type !== 'Identifier' || m.property.name === undefined) {
      return null;
    }
    if (m.object.type === 'Identifier' && m.object.name !== undefined) {
      return `${m.object.name}.${m.property.name}`;
    }
    if (m.object.type === 'ThisExpression') {
      return `this.${m.property.name}`;
    }
    // Deeper chains (a.b.query) — recurse on the object.
    const objectName = getCalleeName(m.object);
    if (objectName !== null) {
      return `${objectName}.${m.property.name}`;
    }
    return null;
  }
  return null;
}

/**
 * Test whether a tagged-template-expression's tag matches the
 * configured tag list. Supports bare-identifier tags (`sql`...`) and
 * member-expression tags (`db.sql`...`).
 */
export function tagMatches(
  tag: unknown,
  configuredTags: readonly string[],
): boolean {
  const name = getCalleeName(tag);
  if (name === null) return false;
  return configuredTags.includes(name);
}
