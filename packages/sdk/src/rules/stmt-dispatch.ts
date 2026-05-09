// Top-level statement-kind dispatch helper.
//
// libpg-query produces an AST shaped as `{ stmts: [{ stmt: { FooStmt: {...} } }, ...] }`.
// Most rules only fire on a specific top-level statement kind (CopyStmt,
// CreateExtensionStmt, MergeStmt, etc.). Walking the entire AST just to
// discover the rule is irrelevant is wasted work — and with 36 rules in
// the registry, the wasted walks dominate analyzer cost.
//
// `hasTopLevelStmt(ast, kinds)` is an O(N_stmts) check (typically 1)
// that lets a rule short-circuit before the expensive astWalk descent.
// It does NOT replace astWalk for rules that need to inspect deep
// subtrees — it just gives them a fast no-op path when the
// statement-kind isn't present at all.
//
// Importantly, this helper is conservative: it only checks TOP-LEVEL
// stmts (one per `;`-separated statement in the input). Rules that
// must fire on, say, a SelectStmt nested inside an InsertStmt's CTE
// should NOT use this gate — they need to walk.

export function hasTopLevelStmt(ast: unknown, kinds: ReadonlySet<string>): boolean {
  if (!ast || typeof ast !== 'object') return false;
  const stmts = (ast as { stmts?: unknown }).stmts;
  if (!Array.isArray(stmts)) return false;
  for (const wrapper of stmts) {
    if (!wrapper || typeof wrapper !== 'object') continue;
    const inner = (wrapper as { stmt?: unknown }).stmt;
    if (!inner || typeof inner !== 'object') continue;
    for (const k of Object.keys(inner as object)) {
      if (kinds.has(k)) return true;
    }
  }
  return false;
}
