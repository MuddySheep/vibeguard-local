// Minimal unified-diff helper for the CLI's --fix-dry-run output.
//
// We don't pull in the `diff` npm package because the output we need
// is small and the algorithm we want — common-prefix / common-suffix
// trimming with the changed middle printed as -/+ — is ~50 lines of
// TS. That's smaller than the dep, and the cost of being slightly
// non-optimal on scattered edits is minor for SQL files where
// changes are usually localized.
//
// Output format mirrors GNU unified-diff conventions:
//
//   --- <oldName>
//   +++ <newName>
//   @@ -L1,N1 +L2,N2 @@
//    context line
//   -removed line
//   +added line
//
// Only one hunk is emitted (the changed middle). For SQL files this
// is essentially always sufficient — a single autofix touches one
// region. If a future fixer applies scattered edits, the runner
// applies them iteratively (one per call), so each diff still has a
// single hunk.

export interface UnifiedDiffOptions {
  /** File label shown after the `---` / `+++` markers. */
  readonly label: string;
  /** Number of context lines around the changed region. Default 2. */
  readonly contextLines?: number;
}

/**
 * Render a unified diff between two SQL strings.
 *
 * Returns an empty string if the inputs are identical.
 */
export function unifiedDiff(
  oldStr: string,
  newStr: string,
  options: UnifiedDiffOptions,
): string {
  if (oldStr === newStr) return '';

  const ctx = options.contextLines ?? 2;
  const oldLines = splitKeepEol(oldStr);
  const newLines = splitKeepEol(newStr);

  // Trim common prefix.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  // Trim common suffix.
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  // Compute hunk window with context.
  const hunkStart = Math.max(0, prefix - ctx);
  const oldHunkEnd = Math.min(oldLines.length, oldEnd + ctx);
  const newHunkEnd = Math.min(newLines.length, newEnd + ctx);

  const oldHunkLen = oldHunkEnd - hunkStart;
  const newHunkLen = newHunkEnd - hunkStart;

  const out: string[] = [];
  out.push(`--- ${options.label}`);
  out.push(`+++ ${options.label}  (after vg-local --fix)`);
  out.push(
    `@@ -${hunkStart + 1},${oldHunkLen} +${hunkStart + 1},${newHunkLen} @@`,
  );

  // Leading context.
  for (let i = hunkStart; i < prefix; i++) {
    out.push(` ${stripEol(oldLines[i] ?? '')}`);
  }
  // Removed lines.
  for (let i = prefix; i < oldEnd; i++) {
    out.push(`-${stripEol(oldLines[i] ?? '')}`);
  }
  // Added lines.
  for (let i = prefix; i < newEnd; i++) {
    out.push(`+${stripEol(newLines[i] ?? '')}`);
  }
  // Trailing context.
  for (let i = oldEnd; i < oldHunkEnd; i++) {
    out.push(` ${stripEol(oldLines[i] ?? '')}`);
  }

  return out.join('\n');
}

/**
 * Split a string into lines, keeping the line terminators on each
 * line (so a round-trip via .join('') preserves the original).
 */
function splitKeepEol(s: string): string[] {
  if (s === '') return [];
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      parts.push(s.slice(cursor, i + 1));
      cursor = i + 1;
    }
  }
  if (cursor < s.length) parts.push(s.slice(cursor));
  return parts;
}

function stripEol(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\n')) return line.slice(0, -1);
  return line;
}
