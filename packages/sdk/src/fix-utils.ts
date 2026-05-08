// Internal helpers shared across fixers. NOT part of the public API
// surface — exported from this file only for the fixer modules; the
// public re-exports in src/index.ts skip these.
//
// The load-bearing helper is `maskStringLiterals`: SQL fixers do
// source-text replacement, and the source can contain string
// literals that look like the patterns we're trying to fix
// (`WHERE comment = '= NULL'`). Masking literals to whitespace of
// the same length lets a subsequent regex match positions that are
// safe to edit, without changing offsets of anything after the literal.
//
// Postgres string-literal forms we mask:
//   - Single-quoted strings, with `''` as the embedded-quote escape
//   - Double-quoted identifiers (regex-literal-pattern matches don't
//     usually hit these, but better to mask defensively)
//   - Escape strings (E'...') — mostly the same shape, with backslash
//     escapes that we don't need to interpret
//   - Dollar-quoted strings ($tag$...$tag$) — common in functions
//
// Block comments (/* ... */) and line comments (-- ...) are also
// masked so their content doesn't trigger false-positive matches.

/**
 * Replace every Postgres string literal, identifier quote, and SQL
 * comment in `sql` with whitespace of identical length. The returned
 * string has the same length and the same byte offsets as `sql` for
 * every non-literal character, so position-based edits computed
 * against the masked string are safe to apply against the original.
 */
export function maskStringLiterals(sql: string): string {
  const out = sql.split('');
  const len = sql.length;
  let i = 0;

  const blank = (start: number, end: number): void => {
    for (let k = start; k < end && k < len; k++) {
      // Preserve newlines so line-anchored regexes still work; replace
      // everything else with spaces.
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };

  while (i < len) {
    const ch = sql[i];

    // Line comment: -- ... \n
    if (ch === '-' && sql[i + 1] === '-') {
      let j = i + 2;
      while (j < len && sql[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }

    // Block comment: /* ... */ (Postgres allows nesting, but we treat
    // first-close as terminator — close enough for fixers, which fall
    // back to "return null" on weird shapes).
    if (ch === '/' && sql[i + 1] === '*') {
      let j = i + 2;
      while (j < len - 1 && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      const end = Math.min(j + 2, len);
      blank(i, end);
      i = end;
      continue;
    }

    // Single-quoted string: '...' with '' as escape, or E'...'
    if (
      ch === "'" ||
      ((ch === 'E' || ch === 'e') && sql[i + 1] === "'")
    ) {
      const start = ch === "'" ? i : i + 1;
      let j = start + 1;
      while (j < len) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted string: $tag$...$tag$
    if (ch === '$') {
      // Match the opening tag: $TAG$ where TAG is [_a-zA-Z][_a-zA-Z0-9]*
      let tagEnd = i + 1;
      while (tagEnd < len && /[A-Za-z0-9_]/.test(sql[tagEnd] as string)) {
        tagEnd++;
      }
      if (tagEnd < len && sql[tagEnd] === '$') {
        const tag = sql.slice(i, tagEnd + 1); // includes both $s
        const closeIdx = sql.indexOf(tag, tagEnd + 1);
        if (closeIdx !== -1) {
          const end = closeIdx + tag.length;
          blank(i, end);
          i = end;
          continue;
        }
      }
    }

    // Double-quoted identifier: "..." with "" as escape
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }

    i++;
  }

  return out.join('');
}
