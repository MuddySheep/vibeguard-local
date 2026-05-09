// Shared, per-AST memoized extractor of all FuncCall function names.
//
// Several rules (SQL-023, SQL-028, SQL-029, SQL-030) detect a fixed
// set of function-name patterns inside FuncCall nodes. Each rule
// independently doing a full astWalk is wasteful — for any SELECT-
// containing fixture we'd traverse the AST four times to look at
// the same FuncCall sub-shape.
//
// extractFuncNames(ast) walks the AST once, collects every FuncCall's
// last funcname segment (lowercased) into a Set, and memoizes it on
// a WeakMap keyed by the AST root. Subsequent calls within the same
// analyze() pass (where every rule receives the same `ast` reference)
// return the cached Set in O(1).
//
// The memo is per-AST. Different analyze() calls produce different AST
// objects and get fresh extraction. Garbage collection clears entries
// when the AST is no longer reachable.

import { astWalk } from '../ast-walk.js';

const cache = new WeakMap<object, ReadonlySet<string>>();

function buildSet(ast: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  astWalk(ast, (node) => {
    if (!node || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    if (!('FuncCall' in obj)) return undefined;
    const fc = obj['FuncCall'] as Record<string, unknown>;
    const fn = fc['funcname'];
    if (!Array.isArray(fn) || fn.length === 0) return undefined;
    const last = fn[fn.length - 1];
    if (!last || typeof last !== 'object') return undefined;
    const s = (last as Record<string, unknown>)['String'];
    if (!s || typeof s !== 'object') return undefined;
    const sval = (s as Record<string, unknown>)['sval'];
    if (typeof sval === 'string') {
      out.add(sval.toLowerCase());
    }
    return undefined;
  });
  return out;
}

export function extractFuncNames(ast: unknown): ReadonlySet<string> {
  if (!ast || typeof ast !== 'object') return new Set<string>();
  const cached = cache.get(ast as object);
  if (cached) return cached;
  const set = buildSet(ast);
  cache.set(ast as object, set);
  return set;
}

/** Return the first name from `targets` that appears in the AST's
 *  function-call set, or null if none do. */
export function firstFuncNameMatch(
  ast: unknown,
  targets: ReadonlySet<string>,
): string | null {
  const present = extractFuncNames(ast);
  for (const t of targets) {
    if (present.has(t)) return t;
  }
  return null;
}
