// `vg-local install-skill` — drop the vibeguard-sql-safety skill into
// every agent harness that's reachable on this machine / project.
//
// What this exists to fix (v1.7.1):
//   1. v1.7.0 shipped a README install recipe that didn't work
//      (`cp node_modules/.../SKILL.md`) because the `files` field
//      excluded `examples/`. SKILL.md is now in the tarball AND this
//      subcommand auto-installs into the right place per harness.
//   2. Description-based skill routing in Claude Code is best-effort.
//      For deterministic activation, this command optionally adds a
//      one-line directive to CLAUDE.md (user or project scope).
//
// Detected harnesses (in order):
//   - Claude Code (user scope)     ~/.claude/        exists
//   - Claude Code (project scope)  .claude/          in cwd
//   - Cursor (.cursorrules)        .cursorrules      in cwd
//   - Cursor (.cursor/rules/)      .cursor/rules/    in cwd
//   - aider                        CONVENTIONS.md OR .aider.conf.yml in cwd
//
// Write strategy per target:
//   - claude-user      → write ~/.claude/skills/vibeguard-sql-safety/SKILL.md
//   - claude-project   → write .claude/skills/vibeguard-sql-safety/SKILL.md
//   - cursor-rules-file → append body (frontmatter stripped) to
//                         .cursorrules between marker comments
//   - cursor-rules-dir  → write .cursor/rules/vibeguard-sql-safety.mdc
//                         (with frontmatter — Cursor's newer format)
//   - aider            → append body (frontmatter stripped) to
//                         CONVENTIONS.md between marker comments
//
// Idempotency: re-running install-skill replaces content between the
// `<!-- vibeguard-skill-begin -->` / `<!-- vibeguard-skill-end -->`
// marker comments rather than appending a second copy. Same for the
// optional CLAUDE.md memory line (`<!-- vibeguard-memory-begin -->`
// / `<!-- vibeguard-memory-end -->`).
//
// CLAUDE.md memory line is opt-in only — the subcommand will not
// write to it without an explicit `--with-memory=<scope>` flag or
// an interactive Yes.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

import pc from 'picocolors';

import { SKILL_MD_CONTENT } from './skill-md-content.generated.js';
import {
  HARNESS_ADAPTERS,
  TARGET_IDS,
  primaryDetectorPath,
  resolvePathTemplate,
  type AdapterDetector,
  type HarnessAdapter,
  type TargetId,
} from './install-skill-adapters.js';

export { SKILL_MD_CONTENT };
export type { TargetId } from './install-skill-adapters.js';

/**
 * The activation directive appended to CLAUDE.md when the user opts
 * in via `--with-memory=<scope>` or the interactive prompt.
 *
 * Phrasing is deliberate: it tells the agent the trigger surface
 * (any SQL-shaped prompt), the required action (invoke the skill
 * BEFORE outputting SQL), and the gate (severity=block is a hard
 * stop). This is the deterministic-activation lever for harnesses
 * whose description-based routing is best-effort.
 */
export const ACTIVATION_MEMORY_LINE =
  '- Whenever the conversation involves SQL (writing, proposing, executing, ' +
  'reviewing migrations, query design, .sql files, DDL, RPC bodies, seed ' +
  'data, or any ORM raw-SQL escape), invoke the `vibeguard-sql-safety` ' +
  'skill BEFORE outputting any SQL. Run `vg-local analyze --stdin ' +
  '--format=jsonl` on every candidate. Treat severity=block as a hard ' +
  'stop requiring explicit human override.';

const SKILL_MARKER_BEGIN = '<!-- vibeguard-skill-begin -->';
const SKILL_MARKER_END = '<!-- vibeguard-skill-end -->';
const MEMORY_MARKER_BEGIN = '<!-- vibeguard-memory-begin -->';
const MEMORY_MARKER_END = '<!-- vibeguard-memory-end -->';

interface InstallTarget {
  readonly id: TargetId;
  readonly name: string;
  readonly scope: 'user' | 'project';
  readonly detected: boolean;
  readonly detectorPath: string;
  readonly destPath: string;
  readonly apply: (force: boolean) => Promise<InstallStatus>;
}

type InstallStatus = 'wrote' | 'replaced' | 'skipped-exists';

export type MemoryScope = 'user' | 'project';

export interface RunInstallSkillOptions {
  readonly cwd?: string;
  readonly homedir?: string;
  readonly out?: NodeJS.WritableStream;
  readonly err?: NodeJS.WritableStream;
  readonly stdin?: NodeJS.ReadableStream;
  /** Skip the interactive confirm; install to all detected targets. */
  readonly yes?: boolean;
  /** Restrict to one specific target id. */
  readonly target?: TargetId;
  /** Overwrite existing files; default is skip-with-warning. */
  readonly force?: boolean;
  /** Pre-resolved memory-scope choice; skips the interactive prompt. */
  readonly withMemory?: MemoryScope;
  /** Skip the memory prompt entirely. */
  readonly noMemory?: boolean;
}

export interface InstallSkillResult {
  exitCode: 0 | 1 | 2;
  installed: TargetId[];
  memoryAdded: MemoryScope | 'none';
}

export async function runInstallSkill(
  args: readonly string[],
  options: RunInstallSkillOptions = {},
): Promise<InstallSkillResult> {
  const cwd = options.cwd ?? process.cwd();
  const homedir = options.homedir ?? os.homedir();
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;

  // Flag parsing — same hand-rolled style as the rest of the CLI.
  let yes = options.yes ?? false;
  let force = options.force ?? false;
  let noMemory = options.noMemory ?? false;
  let withMemory: MemoryScope | undefined = options.withMemory;
  let targetFilter: TargetId | undefined = options.target;
  let showHelp = false;
  let parseError: string | undefined;

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--force') force = true;
    else if (arg === '--no-memory') noMemory = true;
    else if (arg === '--help' || arg === '-h') showHelp = true;
    else if (arg.startsWith('--target=')) {
      const raw = arg.slice('--target='.length);
      if (isTargetId(raw)) {
        targetFilter = raw;
      } else {
        parseError = `unknown --target value ${JSON.stringify(raw)} (valid: ${TARGET_IDS.join(', ')})`;
      }
    } else if (arg.startsWith('--with-memory=')) {
      const raw = arg.slice('--with-memory='.length);
      if (raw === 'user' || raw === 'project') {
        withMemory = raw;
      } else {
        parseError = `unknown --with-memory value ${JSON.stringify(raw)} (valid: user, project)`;
      }
    } else {
      parseError = `unknown argument ${JSON.stringify(arg)}`;
    }
  }

  if (showHelp) {
    printUsage(out);
    return { exitCode: 0, installed: [], memoryAdded: 'none' };
  }
  if (parseError !== undefined) {
    err.write(`vg-local install-skill: ${parseError}\n`);
    err.write(`Run \`vg-local install-skill --help\` for usage.\n`);
    return { exitCode: 2, installed: [], memoryAdded: 'none' };
  }
  if (withMemory !== undefined && noMemory) {
    err.write(
      `vg-local install-skill: --with-memory and --no-memory are mutually exclusive\n`,
    );
    return { exitCode: 2, installed: [], memoryAdded: 'none' };
  }

  // Detect every potential install target.
  const allTargets = await detectTargets(cwd, homedir);

  // Filter to candidates. By default, candidates are detected harnesses.
  // --target=<id> restricts to one specific harness and STILL requires
  // detection (so we don't silently create ~/.claude on a machine
  // that doesn't have Claude Code). --force overrides the detection
  // requirement when combined with --target — that's the escape hatch
  // for "I know what I'm doing, install anyway."
  const candidates =
    targetFilter !== undefined
      ? allTargets.filter(
          (t) => t.id === targetFilter && (t.detected || force),
        )
      : allTargets.filter((t) => t.detected);

  // Print detection summary so the user sees what we found.
  out.write(pc.bold('Detecting agent harnesses...\n\n'));
  for (const t of allTargets) {
    const mark = t.detected ? pc.green('✓') : pc.dim('·');
    const note = t.detected
      ? pc.dim(t.destPath)
      : pc.dim(`(${t.detectorPath} not present)`);
    out.write(`  ${mark} ${t.name.padEnd(30)} ${note}\n`);
  }
  out.write('\n');

  if (candidates.length === 0) {
    if (targetFilter !== undefined) {
      err.write(
        `vg-local install-skill: --target=${targetFilter} but that harness is not present.\n`,
      );
      err.write(
        `Tip: this subcommand is conservative by default and only installs to harnesses\n` +
          `we can auto-detect. To force-install anyway, create the relevant directory\n` +
          `(e.g. \`mkdir ~/.claude\`) first and re-run.\n`,
      );
      return { exitCode: 1, installed: [], memoryAdded: 'none' };
    }
    out.write(pc.yellow('No agent harnesses detected on this machine.\n\n'));
    out.write(`The subcommand only writes to harnesses it can see. Manually create one of\n`);
    out.write(`the marker paths and re-run, or copy the SKILL.md content to a path that\n`);
    out.write(`matches your harness's convention. Supported harnesses + their markers:\n\n`);
    for (const adapter of HARNESS_ADAPTERS) {
      out.write(
        `  ${pc.dim(adapter.id.padEnd(22))}  ${adapter.description}\n`,
      );
    }
    out.write(
      `\nThe SKILL.md file ships in this package at:\n  ${pc.dim('node_modules/@vibeguard-dev/local/examples/agent-skill/SKILL.md')}\n`,
    );
    return { exitCode: 0, installed: [], memoryAdded: 'none' };
  }

  // Confirm before writing, unless --yes.
  const rl =
    !yes && (options.stdin ?? process.stdin) && (process.stdin.isTTY ?? false)
      ? readline.createInterface({
          input: options.stdin ?? process.stdin,
          output: out,
          terminal: true,
        })
      : null;

  if (!yes) {
    if (rl === null) {
      err.write(
        `vg-local install-skill: non-interactive mode requires --yes (or use --target=<id>).\n`,
      );
      return { exitCode: 2, installed: [], memoryAdded: 'none' };
    }
    const names = candidates.map((c) => c.name).join(', ');
    const ok = await confirm(rl, `Install vibeguard-sql-safety to: ${names}?`, true);
    if (!ok) {
      out.write('Aborted.\n');
      rl.close();
      return { exitCode: 0, installed: [], memoryAdded: 'none' };
    }
  }

  // Apply each install. Errors per-target don't abort the run — we
  // report the failure and continue.
  const installed: TargetId[] = [];
  for (const t of candidates) {
    try {
      const status = await t.apply(force);
      if (status === 'wrote') {
        out.write(`  ${pc.green('✓')} wrote ${pc.dim(t.destPath)}\n`);
        installed.push(t.id);
      } else if (status === 'replaced') {
        out.write(
          `  ${pc.green('✓')} updated ${pc.dim(t.destPath)} (replaced between markers)\n`,
        );
        installed.push(t.id);
      } else {
        out.write(
          `  ${pc.yellow('-')} skipped ${pc.dim(t.destPath)} (already exists; --force to overwrite)\n`,
        );
      }
    } catch (e) {
      err.write(
        `  ${pc.red('✗')} ${t.name}: ${(e as Error).message}\n`,
      );
    }
  }
  out.write('\n');

  // Optional CLAUDE.md activation directive.
  let memoryAdded: MemoryScope | 'none' = 'none';
  if (noMemory) {
    // skip entirely
  } else if (withMemory !== undefined) {
    memoryAdded = await applyMemoryLine(withMemory, cwd, homedir, out, err);
  } else if (rl !== null) {
    out.write(
      pc.bold('Optional: pin deterministic activation in CLAUDE.md.\n'),
    );
    out.write(
      pc.dim(
        'Description-based skill routing is best-effort. A one-line directive\n' +
          'in CLAUDE.md makes the skill fire on every SQL-related prompt.\n\n',
      ),
    );
    out.write('  [1] User-level (~/.claude/CLAUDE.md) — every Claude Code session\n');
    out.write('  [2] Project-level (./CLAUDE.md) — this project only\n');
    out.write('  [3] Skip (default)\n\n');
    const choice = (await rl.question('Scope? [3] ')).trim();
    if (choice === '1') {
      memoryAdded = await applyMemoryLine('user', cwd, homedir, out, err);
    } else if (choice === '2') {
      memoryAdded = await applyMemoryLine('project', cwd, homedir, out, err);
    } else {
      out.write(pc.dim('Skipping memory directive.\n'));
    }
  }

  if (rl !== null) rl.close();

  // Final summary.
  if (installed.length > 0) {
    out.write(
      pc.green(
        `\nDone. Skill installed to ${installed.length} target${installed.length === 1 ? '' : 's'}.\n`,
      ),
    );
    if (memoryAdded !== 'none') {
      out.write(
        pc.green(`Activation directive pinned at ${memoryAdded} scope.\n`),
      );
    }
    out.write(
      pc.dim('Open a new agent session (Claude Code / Cursor / aider) to pick up the skill.\n'),
    );
  } else {
    out.write(pc.yellow('No targets installed.\n'));
  }

  return { exitCode: 0, installed, memoryAdded };
}

/* -------------------------------------------------------------------------- */
/*                              detection                                     */
/* -------------------------------------------------------------------------- */
//
// Manifest-driven. Each adapter in HARNESS_ADAPTERS becomes one
// InstallTarget. Adding a new harness is a single-file change to
// install-skill-adapters.ts — no changes here.

async function detectTargets(
  cwd: string,
  homedir: string,
): Promise<InstallTarget[]> {
  return Promise.all(
    HARNESS_ADAPTERS.map(async (adapter) => adapterToTarget(adapter, cwd, homedir)),
  );
}

async function adapterToTarget(
  adapter: HarnessAdapter,
  cwd: string,
  homedir: string,
): Promise<InstallTarget> {
  const detected = await detectorMatches(adapter.detector, cwd, homedir);
  const destPath = resolvePathTemplate(adapter.install.dest, cwd, homedir);
  const detectorPath = primaryDetectorPath(adapter.detector, cwd, homedir);
  return {
    id: adapter.id,
    name: adapter.name,
    scope: adapter.scope,
    detected,
    detectorPath,
    destPath,
    apply: async (force) => applyAdapter(adapter, cwd, homedir, force),
  };
}

async function detectorMatches(
  detector: AdapterDetector,
  cwd: string,
  homedir: string,
): Promise<boolean> {
  if (detector.kind === 'any-of') {
    for (const d of detector.detectors) {
      if (await detectorMatches(d, cwd, homedir)) return true;
    }
    return false;
  }
  const resolved = resolvePathTemplate(detector.path, cwd, homedir);
  if (detector.kind === 'dir-exists') {
    return isDirectory(resolved);
  }
  return isRegularFile(resolved);
}

async function applyAdapter(
  adapter: HarnessAdapter,
  cwd: string,
  homedir: string,
  force: boolean,
): Promise<InstallStatus> {
  const destPath = resolvePathTemplate(adapter.install.dest, cwd, homedir);
  const content =
    adapter.install.content === 'skill-md-full'
      ? SKILL_MD_CONTENT
      : stripFrontmatter(SKILL_MD_CONTENT);

  if (adapter.install.merge === 'append-between-markers') {
    return appendBetweenMarkers(
      destPath,
      content,
      SKILL_MARKER_BEGIN,
      SKILL_MARKER_END,
    );
  }

  // 'overwrite' and 'skip-if-exists' share the same writer; the
  // distinction is just whether --force is implicit. 'overwrite'
  // always writes; 'skip-if-exists' respects existing files unless
  // --force is set.
  const effectiveForce =
    adapter.install.merge === 'overwrite' ? true : force;
  return writeSkillFile(destPath, content, effectiveForce);
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

async function isRegularFile(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/* -------------------------------------------------------------------------- */
/*                              writers                                       */
/* -------------------------------------------------------------------------- */

async function writeSkillFile(
  destPath: string,
  content: string,
  force: boolean,
): Promise<InstallStatus> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  if (!force && (await exists(destPath))) {
    return 'skipped-exists';
  }
  await fs.writeFile(destPath, content, 'utf8');
  return 'wrote';
}

async function appendBetweenMarkers(
  filePath: string,
  body: string,
  markerBegin: string,
  markerEnd: string,
): Promise<InstallStatus> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const block = `${markerBegin}\n${body}\n${markerEnd}`;

  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  if (existing.includes(markerBegin) && existing.includes(markerEnd)) {
    // Idempotent replace between markers.
    const re = new RegExp(
      `${escapeRegExp(markerBegin)}[\\s\\S]*?${escapeRegExp(markerEnd)}`,
      'g',
    );
    const updated = existing.replace(re, block);
    await fs.writeFile(filePath, updated, 'utf8');
    return 'replaced';
  }

  // Fresh append. Ensure a blank line of separation if the existing
  // file doesn't end with one.
  const sep =
    existing.length === 0
      ? ''
      : existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
          ? '\n'
          : '\n\n';
  await fs.writeFile(filePath, existing + sep + block + '\n', 'utf8');
  return 'wrote';
}

/**
 * Strip the YAML frontmatter block from a markdown string. Used for
 * harnesses (Cursor's .cursorrules, aider's CONVENTIONS.md) that
 * don't parse YAML frontmatter and would render the `---` fences as
 * literal horizontal-rule markdown.
 */
function stripFrontmatter(md: string): string {
  const lines = md.split('\n');
  if (lines.length === 0 || lines[0] !== '---') return md;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return md;
  return lines.slice(closeIdx + 1).join('\n').replace(/^\n+/, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -------------------------------------------------------------------------- */
/*                         CLAUDE.md memory line                              */
/* -------------------------------------------------------------------------- */

async function applyMemoryLine(
  scope: MemoryScope,
  cwd: string,
  homedir: string,
  out: NodeJS.WritableStream,
  err: NodeJS.WritableStream,
): Promise<MemoryScope | 'none'> {
  const targetPath =
    scope === 'user'
      ? path.join(homedir, '.claude', 'CLAUDE.md')
      : path.join(cwd, 'CLAUDE.md');

  try {
    await appendBetweenMarkers(
      targetPath,
      ACTIVATION_MEMORY_LINE,
      MEMORY_MARKER_BEGIN,
      MEMORY_MARKER_END,
    );
    out.write(
      `  ${pc.green('✓')} ${scope === 'user' ? 'user-level' : 'project-level'} activation pinned in ${pc.dim(targetPath)}\n`,
    );
    return scope;
  } catch (e) {
    err.write(`  ${pc.red('✗')} could not write ${targetPath}: ${(e as Error).message}\n`);
    return 'none';
  }
}

/* -------------------------------------------------------------------------- */
/*                              prompt helpers                                */
/* -------------------------------------------------------------------------- */

async function confirm(
  rl: readline.Interface,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await rl.question(`${prompt} ${hint} `)).trim();
  if (answer === '') return defaultYes;
  return /^y/i.test(answer);
}

function isTargetId(s: string): s is TargetId {
  return (TARGET_IDS as readonly string[]).includes(s);
}

/* -------------------------------------------------------------------------- */
/*                              usage                                         */
/* -------------------------------------------------------------------------- */

function printUsage(out: NodeJS.WritableStream): void {
  out.write(`vg-local install-skill — install vibeguard-sql-safety into detected agent harnesses

USAGE
  vg-local install-skill [options]

DETECTION (auto-detected from filesystem markers)
${HARNESS_ADAPTERS.map(
  (a) =>
    `  ${a.id.padEnd(22)} ${a.description}`,
).join('\n')}

OPTIONS
  -y, --yes                 Skip the confirmation prompt; install to all detected.
      --target=<id>         Install to one specific harness. Valid ids:
                            ${TARGET_IDS.join(' | ')}
                            By default, the target must be auto-detected;
                            combine with --force to install regardless.
      --force               Overwrite existing files. Combined with --target,
                            also bypasses the detection requirement.
      --with-memory=<scope> Also append a deterministic-activation directive to
                            CLAUDE.md at the given scope (user | project). Opt-in
                            only — by default the subcommand does not touch
                            CLAUDE.md unless you say so.
      --no-memory           Skip the memory-line prompt entirely.
  -h, --help                Show this help.

EXAMPLES
  vg-local install-skill
    Interactive. Detects harnesses, prompts before writing, offers memory line.

  vg-local install-skill --yes
    Non-interactive. Installs to all detected harnesses. Does NOT touch CLAUDE.md.

  vg-local install-skill --yes --with-memory=user
    Non-interactive. Installs to all detected + pins user-level activation.

  vg-local install-skill --target=claude-user --force
    Force-install (overwrite) only to ~/.claude/skills/.

IDEMPOTENCY
  .cursorrules and CONVENTIONS.md writes go between marker comments:
    <!-- vibeguard-skill-begin -->
    ...
    <!-- vibeguard-skill-end -->
  Re-running replaces between the markers — never duplicates. The CLAUDE.md
  memory line uses its own marker pair (<!-- vibeguard-memory-* -->).

UNINSTALL
  Delete the SKILL.md files we wrote, the marker-delimited block in
  .cursorrules / CONVENTIONS.md, and the memory line in CLAUDE.md.
`);
}
