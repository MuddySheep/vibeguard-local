// Reconstruct a template-literal source string from a fixed SQL
// string and the placeholder→source mapping recorded during
// extraction.
//
// The autofix flow is:
//   1. extract.ts → strips `${expr}` → produces SQL with `$N`
//      placeholders + a mapping
//   2. applyFixes() runs on the SQL with placeholders
//   3. THIS module re-inlines `${expr}` for each `$N` that
//      survived through the fix, emitting the new template-literal
//      source (without the surrounding backticks)
//   4. The plugin's autofix wraps the result in backticks and
//      replaces the original TemplateLiteral's source range
//
// Single-pass replacement using a callback so `$1` and `$10` are
// disambiguated correctly: the regex captures `\d+` and we look the
// full `$N` string up in the mapping. No issue with `$1` matching
// inside `$10`.
//
// Placeholders not present in the mapping are left as-is — the
// fix-runner shouldn't introduce new `$N` references, so this is
// defensive.

/**
 * Re-inline `${expr}` text for each `$N` placeholder.
 *
 * @param fixedSql - SQL string after applyFixes, possibly still
 *   containing `$1`, `$2`, ... placeholders that survived through
 *   the fix
 * @param mapping - map from placeholder (`$1`) to original expr
 *   source (e.g. `userId`, `someFunc()`)
 *
 * @returns the template-literal source text WITHOUT surrounding
 *   backticks. The plugin wraps the result in backticks before
 *   feeding the ESLint fixer.
 */
export function reconstructTemplate(
  fixedSql: string,
  mapping: ReadonlyMap<string, string>,
): string {
  return fixedSql.replace(/\$\d+/g, (match) => {
    const expr = mapping.get(match);
    if (expr === undefined) return match;
    return '${' + expr + '}';
  });
}
