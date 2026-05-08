// Shared catch-formatting helpers for the CLI.
//
// Tone is deliberately understated — one example, one fix, one next
// step. We want CI logs and editor-pasted output to read cleanly,
// not to scream for attention. picocolors is used for ANSI coloring;
// when stdout isn't a TTY, picocolors auto-disables colors so the
// output is plain-text-safe.

import pc from 'picocolors';

import type { Catch } from '../types.js';

/**
 * Render a single Catch as a multi-line block.
 *
 *   <indent><filePath>:<lineHint?>
 *     <code> — <title>            <severity · confidence>
 *     <wrapped detail>
 *
 *     fix: <wrapped fix>
 *
 * Severity color: red (block), yellow (warn), cyan (info).
 */
export function formatCatch(c: Catch, filePath: string, lineHint?: number): string {
  const sevColor =
    c.severity === 'block'
      ? pc.red
      : c.severity === 'warn'
        ? pc.yellow
        : pc.cyan;
  const sev = pc.bold(sevColor(`${c.severity} · ${c.confidence}`));

  const path = lineHint !== undefined ? `${filePath}:${lineHint}` : filePath;
  const heading = `  ${pc.dim(path)}`;
  const titleLine = `    ${pc.bold(c.code)} — ${c.title}    ${sev}`;
  const detailLines = wrap(c.detail, 6, 72);
  const fixLines = wrap(`fix: ${c.fix}`, 6, 72);

  return [heading, titleLine, ...detailLines, '', ...fixLines].join('\n');
}

/**
 * Render a "summary" line at the bottom of a CLI run.
 *
 *   N catches in M files.        (no `block` catches present)
 *   N catches in M files.        (M_blocks blocking)
 */
export function formatSummary(
  totalCatches: number,
  totalFiles: number,
  blockCatches: number,
): string {
  const catchWord = totalCatches === 1 ? 'catch' : 'catches';
  const fileWord = totalFiles === 1 ? 'file' : 'files';
  const headline = `${totalCatches} ${catchWord} in ${totalFiles} ${fileWord}.`;
  if (totalCatches === 0) {
    return pc.green(`✓ ${headline}`);
  }
  if (blockCatches > 0) {
    const blockWord = blockCatches === 1 ? 'blocking' : 'blocking';
    return `${pc.bold(headline)} ${pc.red(`(${blockCatches} ${blockWord})`)}`;
  }
  return pc.bold(headline);
}

/**
 * Word-wrap `text` to a given column width, indented by `indent` spaces.
 * Splits on whitespace; preserves single-word lines that exceed the
 * width (rare in our catch prose but possible for long URLs).
 */
function wrap(text: string, indent: number, width: number): string[] {
  const pad = ' '.repeat(indent);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [pad];

  const out: string[] = [];
  let line = pad;
  for (const word of words) {
    if (line === pad) {
      line = pad + word;
      continue;
    }
    if (line.length + 1 + word.length > width) {
      out.push(line);
      line = pad + word;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (line !== pad) out.push(line);
  return out;
}
