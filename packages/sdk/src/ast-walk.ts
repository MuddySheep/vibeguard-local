// Generic depth-first AST traversal helper.
//
// Iterative, not recursive: deeply-nested ASTs (recursive CTEs,
// long expression chains, adversarial input) can produce nesting
// depths that blow Node's default call stack. The iterative DFS
// avoids that class of failure entirely.
//
// `astWalk` exposes two control signals to its visitor:
//   - 'skip'  — do not descend into this node's children
//   - 'stop'  — halt the entire traversal immediately
//   - undefined / void — continue normal descent
//
// The `key` argument tells the visitor what parent-property the
// current node was reached through. Useful for "visit only nodes
// reached via X" patterns without walking the whole tree first.

/**
 * Maximum traversal depth before astWalk halts and emits a single
 * console.warn. Defense-in-depth: libpg-query shouldn't produce
 * cyclic ASTs, but adversarial input could in principle exploit
 * a future parser bug. 1000 is well beyond any realistic
 * legitimate-SQL depth.
 */
export const AST_WALK_MAX_DEPTH = 1000;

/**
 * Visitor signature. Return 'skip' to prune subtrees, 'stop' to halt,
 * or nothing (undefined / void) to continue normal descent.
 *
 * The `key` argument is the property name on the parent that pointed
 * at this node (or `null` for the traversal root). It enables visitors
 * to filter "I only care about nodes inside `whereClause`" without a
 * separate up-front walk.
 */
export type AstVisitor = (
  node: unknown,
  key: string | null,
) => 'skip' | 'stop' | void;

interface Frame {
  readonly node: unknown;
  readonly key: string | null;
  readonly depth: number;
}

/**
 * Depth-first walk of `root`. Visits every object node reachable from
 * `root` exactly once unless the visitor signals 'skip' or 'stop'.
 *
 * Arrays are not themselves visited (visitor only sees object nodes);
 * array elements ARE visited individually. This matches libpg-query's
 * shape where things like `fromClause` are arrays of RangeVar/JoinExpr
 * objects — visitors expect to see each table-shaped node, not the
 * array container.
 *
 * Strings, numbers, booleans, null, and undefined values are skipped
 * (only object nodes are interesting AST shapes for us).
 */
export function astWalk(root: unknown, visit: AstVisitor): void {
  // Stack-based iterative DFS. We push children in reverse so popping
  // yields them in source order — matches recursive descent semantics.
  const stack: Frame[] = [{ node: root, key: null, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, key, depth } = frame;

    if (depth > AST_WALK_MAX_DEPTH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vibeguard-local] astWalk: traversal exceeded MAX_DEPTH=${AST_WALK_MAX_DEPTH}; halting`,
      );
      return;
    }

    if (node === null || node === undefined) continue;
    if (typeof node !== 'object') continue;

    const result = visit(node, key);
    if (result === 'stop') return;
    if (result === 'skip') continue;

    // Push children in reverse to preserve source order on pop.
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k === undefined) continue;
      const child = obj[k];
      if (Array.isArray(child)) {
        for (let j = child.length - 1; j >= 0; j--) {
          stack.push({ node: child[j], key: k, depth: depth + 1 });
        }
      } else if (child !== null && typeof child === 'object') {
        stack.push({ node: child, key: k, depth: depth + 1 });
      }
    }
  }
}
