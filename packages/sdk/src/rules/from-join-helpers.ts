// Shared helpers for rules SQL-035 and SQL-036 (UPDATE…FROM / DELETE…USING
  // missing-join-predicate detection).

  interface AnyNode {
    readonly [k: string]: unknown;
  }

  export function rangeVarName(rv: unknown): string | undefined {
    if (!rv || typeof rv !== 'object') return undefined;
    const inner = (rv as AnyNode)['RangeVar'] ?? rv;
    if (!inner || typeof inner !== 'object') return undefined;
    const o = inner as AnyNode;
    const alias = o['alias'];
    if (alias && typeof alias === 'object') {
      const a = (alias as AnyNode)['aliasname'];
      if (typeof a === 'string') return a;
    }
    const rn = o['relname'];
    return typeof rn === 'string' ? rn : undefined;
  }

  // Walk a subtree, calling visit on every object node. Stops if visit returns 'stop'.
  export function walkSubtree(node: unknown, visit: (n: object) => 'stop' | undefined): boolean {
    if (!node) return false;
    if (Array.isArray(node)) {
      for (const c of node) {
        if (walkSubtree(c, visit)) return true;
      }
      return false;
    }
    if (typeof node !== 'object') return false;
    if (visit(node) === 'stop') return true;
    for (const v of Object.values(node as object)) {
      if (walkSubtree(v, visit)) return true;
    }
    return false;
  }

  // Returns true if any ColumnRef in the subtree has a leading qualifier
  // matching one of the given names (case-sensitive).
  export function whereHasQualifierIn(whereNode: unknown, names: ReadonlySet<string>): boolean {
    if (names.size === 0) return false;
    let found = false;
    walkSubtree(whereNode, (n) => {
      const cr = (n as AnyNode)['ColumnRef'];
      if (!cr || typeof cr !== 'object') return undefined;
      const fields = (cr as AnyNode)['fields'];
      if (!Array.isArray(fields) || fields.length < 2) return undefined;
      // qualifier is fields[0]
      const f0 = fields[0];
      if (!f0 || typeof f0 !== 'object') return undefined;
      const s = (f0 as AnyNode)['String'];
      if (!s || typeof s !== 'object') return undefined;
      const sval = (s as AnyNode)['sval'];
      if (typeof sval !== 'string') return undefined;
      if (names.has(sval)) {
        found = true;
        return 'stop';
      }
      return undefined;
    });
    return found;
  }
  