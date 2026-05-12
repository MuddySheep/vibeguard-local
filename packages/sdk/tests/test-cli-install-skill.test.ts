import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runInstallSkill,
  SKILL_MD_CONTENT,
  ACTIVATION_MEMORY_LINE,
} from '../src/cli/install-skill.js';

// EPIC-OSS-5 / STORY-5.5 — install-skill subcommand.
//
// Three layers of coverage:
//   1. Drift prevention: SKILL_MD_CONTENT inline matches the file
//      on disk byte-for-byte. (The generator + this assertion together
//      guarantee no silent drift.)
//   2. Detection: each harness is recognized from its filesystem
//      marker when we mock cwd / homedir to point at a temp tree.
//   3. Install: the right file lands at the right path; idempotency
//      and --force overwrite behavior both hold.
//
// All tests use a temp cwd and a temp homedir so we never touch the
// real ~/.claude or the developer's working directory.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const SKILL_MD_SOURCE_PATH = path.join(
  PACKAGE_ROOT,
  'examples',
  'agent-skill',
  'SKILL.md',
);

let tmpDir: string;
let tmpHome: string;
let stdoutCalls: string[];
let stderrCalls: string[];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-install-cwd-'));
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-install-home-'));
  stdoutCalls = [];
  stderrCalls = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutCalls.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrCalls.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* */
  }
  try {
    await fs.rm(tmpHome, { recursive: true, force: true });
  } catch {
    /* */
  }
});

function stdoutText(): string {
  return stdoutCalls.join('');
}
function stderrText(): string {
  return stderrCalls.join('');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readUtf8(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

/**
 * Captures stdout/stderr into per-call buffers so we can assert on
 * them. Defaults --yes to true so the tests don't hang on interactive
 * prompts.
 */
function callOptions(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: tmpDir,
    homedir: tmpHome,
    out: { write: (c: string | Buffer) => { stdoutCalls.push(typeof c === 'string' ? c : c.toString()); return true; } },
    err: { write: (c: string | Buffer) => { stderrCalls.push(typeof c === 'string' ? c : c.toString()); return true; } },
    yes: true,
    noMemory: true,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/*                          drift-prevention                                  */
/* -------------------------------------------------------------------------- */

describe('SKILL_MD_CONTENT — drift prevention', () => {
  it('inlined constant matches examples/agent-skill/SKILL.md byte-for-byte', async () => {
    const onDisk = await fs.readFile(SKILL_MD_SOURCE_PATH, 'utf8');
    expect(SKILL_MD_CONTENT).toBe(onDisk);
  });

  it('content begins with the YAML frontmatter fence', () => {
    expect(SKILL_MD_CONTENT.startsWith('---\n')).toBe(true);
  });

  it('content contains the mandatory-activation directive in the description', () => {
    expect(SKILL_MD_CONTENT).toContain('MANDATORY pre-flight for ALL SQL operations');
  });

  it('content contains the autofix loop section', () => {
    expect(SKILL_MD_CONTENT).toContain('## The autofix loop');
  });
});

/* -------------------------------------------------------------------------- */
/*                          detection                                         */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — detection', () => {
  it('with nothing on disk → prints "no harnesses found", exit 0', async () => {
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.exitCode).toBe(0);
    expect(r.installed).toEqual([]);
    expect(stdoutText()).toContain('No agent harnesses detected');
  });

  it('detects Claude Code user scope when ~/.claude exists', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.exitCode).toBe(0);
    expect(r.installed).toEqual(['claude-user']);
    const written = path.join(
      tmpHome,
      '.claude',
      'skills',
      'vibeguard-sql-safety',
      'SKILL.md',
    );
    expect(await fileExists(written)).toBe(true);
    expect(await readUtf8(written)).toBe(SKILL_MD_CONTENT);
  });

  it('detects Claude Code project scope when ./.claude exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['claude-project']);
    expect(await fileExists(
      path.join(tmpDir, '.claude', 'skills', 'vibeguard-sql-safety', 'SKILL.md'),
    )).toBe(true);
  });

  it('detects .cursorrules in cwd', async () => {
    await fs.writeFile(path.join(tmpDir, '.cursorrules'), '# existing\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['cursor-rules-file']);
    const updated = await readUtf8(path.join(tmpDir, '.cursorrules'));
    expect(updated).toContain('# existing');
    expect(updated).toContain('<!-- vibeguard-skill-begin -->');
    expect(updated).toContain('<!-- vibeguard-skill-end -->');
    // Frontmatter must be stripped for .cursorrules.
    expect(updated).not.toContain('---\nname: vibeguard-sql-safety');
  });

  it('detects .cursor/rules/ directory', async () => {
    await fs.mkdir(path.join(tmpDir, '.cursor', 'rules'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['cursor-rules-dir']);
    const mdc = path.join(tmpDir, '.cursor', 'rules', 'vibeguard-sql-safety.mdc');
    expect(await fileExists(mdc)).toBe(true);
    // Frontmatter is preserved for the .mdc variant.
    expect(await readUtf8(mdc)).toBe(SKILL_MD_CONTENT);
  });

  it('detects aider via CONVENTIONS.md', async () => {
    await fs.writeFile(path.join(tmpDir, 'CONVENTIONS.md'), '# Project conventions\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['aider']);
    const updated = await readUtf8(path.join(tmpDir, 'CONVENTIONS.md'));
    expect(updated).toContain('# Project conventions');
    expect(updated).toContain('<!-- vibeguard-skill-begin -->');
    // Frontmatter stripped for CONVENTIONS.md too.
    expect(updated).not.toContain('---\nname: vibeguard-sql-safety');
  });

  it('detects aider via .aider.conf.yml', async () => {
    await fs.writeFile(path.join(tmpDir, '.aider.conf.yml'), 'auto-commits: false\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['aider']);
    // CONVENTIONS.md is created fresh because .aider.conf.yml only signals
    // aider's presence, not where the conventions live.
    expect(await fileExists(path.join(tmpDir, 'CONVENTIONS.md'))).toBe(true);
  });

  it('detects multiple harnesses simultaneously', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.cursorrules'), '', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed.sort()).toEqual(['claude-user', 'cursor-rules-file'].sort());
  });
});

/* -------------------------------------------------------------------------- */
/*                          idempotency                                       */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — idempotency', () => {
  it('re-running with .cursorrules does not duplicate the skill block', async () => {
    await fs.writeFile(path.join(tmpDir, '.cursorrules'), '# original\n', 'utf8');
    await runInstallSkill([], callOptions() as never);
    await runInstallSkill([], callOptions() as never);
    const final = await readUtf8(path.join(tmpDir, '.cursorrules'));
    const beginCount = final.split('<!-- vibeguard-skill-begin -->').length - 1;
    const endCount = final.split('<!-- vibeguard-skill-end -->').length - 1;
    expect(beginCount).toBe(1);
    expect(endCount).toBe(1);
    expect(final).toContain('# original');
  });

  it('re-running with claude-user without --force skips on second run', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await runInstallSkill([], callOptions() as never);
    const claudeFile = path.join(
      tmpHome, '.claude', 'skills', 'vibeguard-sql-safety', 'SKILL.md',
    );
    const firstWriteContent = await readUtf8(claudeFile);

    // Mutate the file so we can tell if it gets overwritten.
    await fs.writeFile(claudeFile, '# user-edited\n', 'utf8');

    stdoutCalls = []; stderrCalls = [];
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual([]);  // skipped, not installed
    expect(stdoutText()).toContain('skipped');
    expect(await readUtf8(claudeFile)).toBe('# user-edited\n');

    // With --force, the install proceeds.
    stdoutCalls = []; stderrCalls = [];
    const r2 = await runInstallSkill(['--force'], callOptions({ force: true }) as never);
    expect(r2.installed).toEqual(['claude-user']);
    expect(await readUtf8(claudeFile)).toBe(firstWriteContent);
  });
});

/* -------------------------------------------------------------------------- */
/*                          --target restriction                              */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — --target', () => {
  it('--target=claude-user installs only there even when other harnesses are detected', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.cursorrules'), '', 'utf8');
    const r = await runInstallSkill(
      ['--target=claude-user'],
      callOptions({ target: 'claude-user' }) as never,
    );
    expect(r.installed).toEqual(['claude-user']);
    // .cursorrules should NOT have been touched
    expect(await readUtf8(path.join(tmpDir, '.cursorrules'))).toBe('');
  });

  it('--target=claude-user when not detected → exit 1', async () => {
    const r = await runInstallSkill(
      ['--target=claude-user'],
      callOptions({ target: 'claude-user' }) as never,
    );
    expect(r.exitCode).toBe(1);
    expect(stderrText()).toContain('not present');
  });

  it('--target=<unknown> → exit 2 with usage error', async () => {
    // Pass via args (not options) so the arg parser sees it.
    const r = await runInstallSkill(
      ['--target=quackquack'],
      { ...callOptions(), target: undefined } as never,
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('unknown --target');
  });
});

/* -------------------------------------------------------------------------- */
/*                          --with-memory                                     */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — CLAUDE.md memory line', () => {
  it('default mode (no flag, non-interactive) does NOT touch CLAUDE.md', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.memoryAdded).toBe('none');
    expect(await fileExists(path.join(tmpHome, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(await fileExists(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
  });

  it('--with-memory=user appends to ~/.claude/CLAUDE.md', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const r = await runInstallSkill(
      [],
      callOptions({ withMemory: 'user', noMemory: false }) as never,
    );
    expect(r.memoryAdded).toBe('user');
    const memPath = path.join(tmpHome, '.claude', 'CLAUDE.md');
    expect(await fileExists(memPath)).toBe(true);
    const content = await readUtf8(memPath);
    expect(content).toContain('<!-- vibeguard-memory-begin -->');
    expect(content).toContain('<!-- vibeguard-memory-end -->');
    expect(content).toContain(ACTIVATION_MEMORY_LINE);
  });

  it('--with-memory=project appends to ./CLAUDE.md', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const r = await runInstallSkill(
      [],
      callOptions({ withMemory: 'project', noMemory: false }) as never,
    );
    expect(r.memoryAdded).toBe('project');
    expect(await fileExists(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
    expect(await fileExists(path.join(tmpHome, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('re-running --with-memory does not duplicate the line', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await runInstallSkill(
      [],
      callOptions({ withMemory: 'user', noMemory: false }) as never,
    );
    await runInstallSkill(
      [],
      callOptions({ withMemory: 'user', noMemory: false }) as never,
    );
    const content = await readUtf8(path.join(tmpHome, '.claude', 'CLAUDE.md'));
    const beginCount = content.split('<!-- vibeguard-memory-begin -->').length - 1;
    expect(beginCount).toBe(1);
  });

  it('--with-memory + --no-memory → exit 2', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    const r = await runInstallSkill(
      [],
      callOptions({ withMemory: 'user', noMemory: true }) as never,
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('mutually exclusive');
  });
});

/* -------------------------------------------------------------------------- */
/*                          flag parsing edges                                */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — flag parsing', () => {
  it('--help prints usage and exits 0', async () => {
    const r = await runInstallSkill(['--help'], callOptions() as never);
    expect(r.exitCode).toBe(0);
    expect(stdoutText()).toContain('install vibeguard-sql-safety');
    expect(stdoutText()).toContain('--with-memory');
  });

  it('--help lists every supported target id', async () => {
    await runInstallSkill(['--help'], callOptions() as never);
    const help = stdoutText();
    for (const id of [
      'claude-user',
      'claude-project',
      'cursor-rules-file',
      'cursor-rules-dir',
      'aider',
      'agents-md',
      'copilot-cli',
      'gemini',
      'windsurf-rules-file',
      'windsurf-rules-dir',
    ]) {
      expect(help).toContain(id);
    }
  });

  it('unknown argument → exit 2 with usage hint', async () => {
    const r = await runInstallSkill(['--quack'], callOptions() as never);
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('unknown argument');
  });

  it('--with-memory=invalid → exit 2', async () => {
    const r = await runInstallSkill(
      ['--with-memory=somewhere'],
      // Drop the option-level withMemory so the arg parser sees it.
      { ...callOptions(), withMemory: undefined } as never,
    );
    expect(r.exitCode).toBe(2);
    expect(stderrText()).toContain('unknown --with-memory');
  });

  it('unknown --target lists all 10 valid ids in the error', async () => {
    const r = await runInstallSkill(
      ['--target=quackquack'],
      { ...callOptions(), target: undefined } as never,
    );
    expect(r.exitCode).toBe(2);
    const stderr = stderrText();
    for (const id of [
      'claude-user',
      'agents-md',
      'copilot-cli',
      'gemini',
      'windsurf-rules-file',
      'windsurf-rules-dir',
    ]) {
      expect(stderr).toContain(id);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                  v1.8.0 — new harnesses (manifest-driven)                  */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — v1.8.0 new harnesses', () => {
  it('agents-md: detects via AGENTS.md presence; appends between markers', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# Existing agents\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['agents-md']);
    const content = await readUtf8(path.join(tmpDir, 'AGENTS.md'));
    expect(content).toContain('# Existing agents');
    expect(content).toContain('<!-- vibeguard-skill-begin -->');
    expect(content).toContain('<!-- vibeguard-skill-end -->');
    // Frontmatter stripped — AGENTS.md doesn't parse YAML.
    expect(content).not.toContain('---\nname: vibeguard-sql-safety');
  });

  it('agents-md: detects via opencode.json (no AGENTS.md present)', async () => {
    await fs.writeFile(path.join(tmpDir, 'opencode.json'), '{}\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['agents-md']);
    expect(await fileExists(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
  });

  it('agents-md: detects via .pi/ directory', async () => {
    await fs.mkdir(path.join(tmpDir, '.pi'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['agents-md']);
  });

  it('agents-md: detects via .openclaw-system.md', async () => {
    await fs.writeFile(path.join(tmpDir, '.openclaw-system.md'), 'system\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['agents-md']);
  });

  it('agents-md: re-running does not duplicate the marker block', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# Original\n', 'utf8');
    await runInstallSkill([], callOptions() as never);
    await runInstallSkill([], callOptions() as never);
    const content = await readUtf8(path.join(tmpDir, 'AGENTS.md'));
    const beginCount = content.split('<!-- vibeguard-skill-begin -->').length - 1;
    expect(beginCount).toBe(1);
    expect(content).toContain('# Original');
  });

  it('copilot-cli: detects via .github/instructions/ and writes the path-specific file', async () => {
    await fs.mkdir(path.join(tmpDir, '.github', 'instructions'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toContain('copilot-cli');
    const target = path.join(
      tmpDir,
      '.github',
      'instructions',
      'vibeguard-sql-safety.instructions.md',
    );
    expect(await fileExists(target)).toBe(true);
    // Body-only — no YAML frontmatter (Copilot CLI doesn't parse it).
    const content = await readUtf8(target);
    expect(content).not.toContain('---\nname: vibeguard-sql-safety');
    expect(content).toContain('# vibeguard-sql-safety');
  });

  it('copilot-cli: detects via .github/copilot-instructions.md', async () => {
    await fs.mkdir(path.join(tmpDir, '.github'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.github', 'copilot-instructions.md'),
      '# existing\n',
      'utf8',
    );
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toContain('copilot-cli');
  });

  it('gemini: detects via gemini.md and appends between markers', async () => {
    await fs.writeFile(path.join(tmpDir, 'gemini.md'), '# Project rules\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['gemini']);
    const content = await readUtf8(path.join(tmpDir, 'gemini.md'));
    expect(content).toContain('# Project rules');
    expect(content).toContain('<!-- vibeguard-skill-begin -->');
    expect(content).not.toContain('---\nname: vibeguard-sql-safety');
  });

  it('gemini: detects via .gemini/ directory', async () => {
    await fs.mkdir(path.join(tmpDir, '.gemini'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['gemini']);
    // gemini.md is created fresh because the dir alone doesn't tell
    // us where else to write.
    expect(await fileExists(path.join(tmpDir, 'gemini.md'))).toBe(true);
  });

  it('windsurf-rules-file: detects .windsurfrules and appends between markers', async () => {
    await fs.writeFile(path.join(tmpDir, '.windsurfrules'), '# Existing\n', 'utf8');
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['windsurf-rules-file']);
    const content = await readUtf8(path.join(tmpDir, '.windsurfrules'));
    expect(content).toContain('# Existing');
    expect(content).toContain('<!-- vibeguard-skill-begin -->');
    expect(content).not.toContain('---\nname: vibeguard-sql-safety');
  });

  it('windsurf-rules-dir: writes vibeguard-sql-safety.md (no frontmatter)', async () => {
    await fs.mkdir(path.join(tmpDir, '.windsurf', 'rules'), { recursive: true });
    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed).toEqual(['windsurf-rules-dir']);
    const target = path.join(
      tmpDir,
      '.windsurf',
      'rules',
      'vibeguard-sql-safety.md',
    );
    expect(await fileExists(target)).toBe(true);
    const content = await readUtf8(target);
    expect(content).not.toContain('---\nname: vibeguard-sql-safety');
    expect(content).toContain('# vibeguard-sql-safety');
  });
});

/* -------------------------------------------------------------------------- */
/*                  multi-harness AGENTS.md dedup                             */
/* -------------------------------------------------------------------------- */

describe('runInstallSkill — multi-harness scenarios', () => {
  it('claude-user + agents-md + gemini all install in one run', async () => {
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'gemini.md'), '', 'utf8');

    const r = await runInstallSkill([], callOptions() as never);
    expect(r.installed.sort()).toEqual(['agents-md', 'claude-user', 'gemini'].sort());

    // All three files have the skill content.
    expect(await fileExists(
      path.join(tmpHome, '.claude', 'skills', 'vibeguard-sql-safety', 'SKILL.md'),
    )).toBe(true);

    const agentsContent = await readUtf8(path.join(tmpDir, 'AGENTS.md'));
    expect(agentsContent).toContain('<!-- vibeguard-skill-begin -->');

    const geminiContent = await readUtf8(path.join(tmpDir, 'gemini.md'));
    expect(geminiContent).toContain('<!-- vibeguard-skill-begin -->');
  });

  it('--target=agents-md alone, with detection signal, installs only there', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'gemini.md'), '', 'utf8');  // also detected
    const r = await runInstallSkill(
      ['--target=agents-md'],
      callOptions({ target: 'agents-md' }) as never,
    );
    expect(r.installed).toEqual(['agents-md']);
    // gemini.md should NOT have been touched (still empty)
    expect(await readUtf8(path.join(tmpDir, 'gemini.md'))).toBe('');
  });
});
