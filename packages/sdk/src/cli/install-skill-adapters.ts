// Declarative adapter manifests for `vg-local install-skill`.
//
// Each entry in `HARNESS_ADAPTERS` describes one agent harness:
//   - id          — stable identifier (used by --target=<id>)
//   - name        — human-readable label shown in detection output
//   - description — short prose shown in --help
//   - scope       — 'user' (per-machine) or 'project' (per-repo)
//   - detector    — filesystem signal that means "this harness is
//                   installed here". Detection only — we never write
//                   without an explicit install action.
//   - install     — exactly one write per adapter:
//                   * content: 'skill-md-full'      → SKILL.md as-is (frontmatter included)
//                              'skill-md-body-only' → frontmatter stripped (harnesses
//                                                     that don't parse YAML render
//                                                     the --- fences as horizontal rules)
//                   * dest:    destination path with ${HOME} / ${CWD} placeholders
//                   * merge:   'overwrite'              — replace contents wholesale (creates the
//                                                          parent dir if needed)
//                              'append-between-markers' — idempotent block-write, replaces
//                                                          between the marker comments on re-run
//                              'skip-if-exists'         — leave the file alone if it's already there;
//                                                          --force overrides this
//
// Adding a new harness in the future is a single change to this file —
// no changes needed in install-skill.ts. The same constraint applies
// the other way: nothing in this file talks to the filesystem; pure
// data + types.
//
// Detection design notes:
//   - AGENTS.md is shared across many harnesses (Codex, OpenCode,
//     OpenClaw, Hermes, Pi, etc.). We treat it as ONE target
//     ('agents-md') rather than one-per-harness because:
//       (a) install-time deduplication is automatic — there's exactly
//           one file, one marker block
//       (b) "AGENTS.md exists" is a coarse but actionable signal: at
//           least one agents-md-aware harness is configured here
//   - Harnesses with their own unique marker file/dir (Cursor's
//     .cursorrules, Copilot CLI's .github/instructions/, Pi's .pi/)
//     get their own target.
//
// Standalone-python adapter (from the maintainer's local
// `docs/adapters/standalone-python/`) is deliberately NOT here — it's
// a DIY conductor entrypoint pattern (write your own `run.py` that
// calls vg-local from a Python loop), not a skill-file install. The
// manual pattern is documented in `examples/agent-skill/README.md`.
//
// Antigravity (Google) is also deferred — the public detection signal
// isn't yet stable. When it firms up, one new entry below covers it.

/**
 * Stable target identifiers. The string union doubles as the
 * `--target=<id>` flag value type. Each id maps to exactly one
 * `HarnessAdapter` in the array below.
 */
export type TargetId =
  | 'claude-user'
  | 'claude-project'
  | 'cursor-rules-file'
  | 'cursor-rules-dir'
  | 'aider'
  | 'agents-md'
  | 'copilot-cli'
  | 'gemini'
  | 'windsurf-rules-file'
  | 'windsurf-rules-dir';

/**
 * Filesystem signal that means a harness is present. Three shapes:
 *   - dir-exists  — directory at the given path
 *   - file-exists — file at the given path
 *   - any-of      — disjunction of detectors; first match wins
 *
 * Paths use `${HOME}` / `${CWD}` placeholders so a manifest is the
 * same on every machine. The path-resolution helper expands them.
 */
export type AdapterDetector =
  | { readonly kind: 'dir-exists'; readonly path: string }
  | { readonly kind: 'file-exists'; readonly path: string }
  | { readonly kind: 'any-of'; readonly detectors: readonly AdapterDetector[] };

/**
 * One install action per adapter. v1.8.0 keeps it to a single action
 * per harness — the multi-step adapters in the maintainer's
 * agentic-stack reference are bigger than what VibeGuard needs (the
 * SQL-safety skill is one file, not a brain).
 */
export interface AdapterInstallStep {
  readonly content: 'skill-md-full' | 'skill-md-body-only';
  readonly dest: string;
  readonly merge: 'overwrite' | 'append-between-markers' | 'skip-if-exists';
}

export interface HarnessAdapter {
  readonly id: TargetId;
  readonly name: string;
  readonly description: string;
  readonly scope: 'user' | 'project';
  readonly detector: AdapterDetector;
  readonly install: AdapterInstallStep;
}

/**
 * THE manifest list. Add new harnesses here. Each entry is
 * self-contained: detection logic + install action.
 *
 * Ordering: user-scope first, then project-scope. Within project
 * scope, harnesses with their own unique marker before the
 * shared-AGENTS.md target so the detection output reads top-down
 * from "more specific signal" to "general signal."
 */
export const HARNESS_ADAPTERS: readonly HarnessAdapter[] = [
  // ── Claude Code ────────────────────────────────────────────────
  {
    id: 'claude-user',
    name: 'Claude Code (user)',
    description: '~/.claude/skills/ — applies to every Claude Code session',
    scope: 'user',
    detector: { kind: 'dir-exists', path: '${HOME}/.claude' },
    install: {
      content: 'skill-md-full',
      dest: '${HOME}/.claude/skills/vibeguard-sql-safety/SKILL.md',
      merge: 'skip-if-exists',
    },
  },
  {
    id: 'claude-project',
    name: 'Claude Code (project)',
    description: '.claude/skills/ in this project',
    scope: 'project',
    detector: { kind: 'dir-exists', path: '${CWD}/.claude' },
    install: {
      content: 'skill-md-full',
      dest: '${CWD}/.claude/skills/vibeguard-sql-safety/SKILL.md',
      merge: 'skip-if-exists',
    },
  },

  // ── Cursor ─────────────────────────────────────────────────────
  {
    id: 'cursor-rules-file',
    name: 'Cursor (.cursorrules)',
    description: 'Legacy single-file Cursor instructions; always-on per prompt',
    scope: 'project',
    detector: { kind: 'file-exists', path: '${CWD}/.cursorrules' },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/.cursorrules',
      merge: 'append-between-markers',
    },
  },
  {
    id: 'cursor-rules-dir',
    name: 'Cursor (.cursor/rules/)',
    description: 'Modern Cursor rules directory; one .mdc file per rule (parses YAML frontmatter for routing)',
    scope: 'project',
    detector: { kind: 'dir-exists', path: '${CWD}/.cursor/rules' },
    install: {
      // .mdc files DO parse YAML frontmatter — Cursor uses it for
      // skill metadata. Ship the full file (matches v1.7.1 behavior).
      content: 'skill-md-full',
      dest: '${CWD}/.cursor/rules/vibeguard-sql-safety.mdc',
      merge: 'overwrite',
    },
  },

  // ── aider ──────────────────────────────────────────────────────
  {
    id: 'aider',
    name: 'aider (CONVENTIONS.md)',
    description: 'aider conventions file; reference via `aider --read CONVENTIONS.md`',
    scope: 'project',
    detector: {
      kind: 'any-of',
      detectors: [
        { kind: 'file-exists', path: '${CWD}/CONVENTIONS.md' },
        { kind: 'file-exists', path: '${CWD}/.aider.conf.yml' },
      ],
    },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/CONVENTIONS.md',
      merge: 'append-between-markers',
    },
  },

  // ── GitHub Copilot CLI ─────────────────────────────────────────
  //
  // Copilot CLI reads `.github/copilot-instructions.md` (general) and
  // `.github/instructions/*.instructions.md` (path-specific). We
  // install a path-specific file targeted at SQL — Copilot picks it
  // up when SQL is in context.
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    description: '.github/instructions/ — path-specific Copilot instructions',
    scope: 'project',
    detector: {
      kind: 'any-of',
      detectors: [
        { kind: 'dir-exists', path: '${CWD}/.github/instructions' },
        { kind: 'file-exists', path: '${CWD}/.github/copilot-instructions.md' },
        { kind: 'dir-exists', path: '${CWD}/.github/copilot' },
      ],
    },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/.github/instructions/vibeguard-sql-safety.instructions.md',
      merge: 'overwrite',
    },
  },

  // ── Gemini CLI ─────────────────────────────────────────────────
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'gemini.md or .gemini/ — Google Gemini CLI instructions',
    scope: 'project',
    detector: {
      kind: 'any-of',
      detectors: [
        { kind: 'file-exists', path: '${CWD}/gemini.md' },
        { kind: 'dir-exists', path: '${CWD}/.gemini' },
      ],
    },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/gemini.md',
      merge: 'append-between-markers',
    },
  },

  // ── Windsurf (Codeium) ─────────────────────────────────────────
  {
    id: 'windsurf-rules-file',
    name: 'Windsurf (.windsurfrules)',
    description: 'Legacy Windsurf single-file rules; always-on per prompt',
    scope: 'project',
    detector: { kind: 'file-exists', path: '${CWD}/.windsurfrules' },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/.windsurfrules',
      merge: 'append-between-markers',
    },
  },
  {
    id: 'windsurf-rules-dir',
    name: 'Windsurf (.windsurf/rules/)',
    description: 'Modern Windsurf rules directory',
    scope: 'project',
    detector: { kind: 'dir-exists', path: '${CWD}/.windsurf/rules' },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/.windsurf/rules/vibeguard-sql-safety.md',
      merge: 'overwrite',
    },
  },

  // ── AGENTS.md (shared by Codex CLI, OpenCode, OpenClaw, Hermes, Pi) ──
  //
  // AGENTS.md is the convention-of-conventions: it's the instruction
  // file that Codex CLI, OpenCode, OpenClaw, Hermes (Nous Research),
  // Pi (Inflection), and other harnesses read at session start. We
  // ship ONE adapter targeting this file; the marker-based append
  // means re-runs are idempotent and any of these harnesses will
  // pick up the skill content.
  //
  // Detection is conservative: AGENTS.md must already exist, OR a
  // harness-specific marker (.pi/, opencode.json) is present.
  // We do NOT create AGENTS.md on a machine that doesn't have one;
  // that would be invasive.
  {
    id: 'agents-md',
    name: 'AGENTS.md (Codex / OpenCode / OpenClaw / Hermes / Pi)',
    description: 'Shared AGENTS.md convention used by 5+ harnesses',
    scope: 'project',
    detector: {
      kind: 'any-of',
      detectors: [
        { kind: 'file-exists', path: '${CWD}/AGENTS.md' },
        { kind: 'file-exists', path: '${CWD}/opencode.json' },
        { kind: 'dir-exists', path: '${CWD}/.pi' },
        { kind: 'file-exists', path: '${CWD}/.openclaw-system.md' },
      ],
    },
    install: {
      content: 'skill-md-body-only',
      dest: '${CWD}/AGENTS.md',
      merge: 'append-between-markers',
    },
  },
];

/** Ordered list of all valid TargetIds — used for `--target=` validation. */
export const TARGET_IDS: readonly TargetId[] = HARNESS_ADAPTERS.map(
  (a) => a.id,
);

/**
 * Resolve a path template against the current cwd + homedir.
 * Substitutes `${HOME}` and `${CWD}` placeholders, then normalizes
 * separators to the platform default.
 */
export function resolvePathTemplate(
  template: string,
  cwd: string,
  homedir: string,
): string {
  return template
    .replace(/\$\{HOME\}/g, homedir)
    .replace(/\$\{CWD\}/g, cwd);
}

/**
 * Return the "primary" detector path for an adapter — used in the
 * detection-summary output line ("...exists" / "...not present").
 * For `any-of` detectors, returns the first detector's path.
 */
export function primaryDetectorPath(
  detector: AdapterDetector,
  cwd: string,
  homedir: string,
): string {
  if (detector.kind === 'any-of') {
    return primaryDetectorPath(detector.detectors[0]!, cwd, homedir);
  }
  return resolvePathTemplate(detector.path, cwd, homedir);
}
