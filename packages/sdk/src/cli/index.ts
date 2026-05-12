// vg-local CLI entry point.
//
// Subcommands:
//   init                 — first-run scaffolder (vibeguard.example.sql + npm script)
//   analyze <glob...>    — analyze SQL files matching one or more globs
//   install-skill        — install vibeguard-sql-safety into detected
//                          agent harnesses (Claude Code, Cursor, aider)
//
// Top-level flags:
//   -h / --help          — print usage
//   -v / --version       — print the SDK version (read from package.json
//                          at build time via tsup's import-meta-url shim)
//
// Arg parsing is hand-rolled to keep the dependency footprint small.
// We don't ship `mri` / `cac` because the surface is tiny and stable;
// the cost of a CLI args library would exceed the cost of the parser
// itself.

import { runAnalyze } from './analyze.js';
import { runInit } from './init.js';
import { runInstallSkill } from './install-skill.js';

// Sync with package.json on each release. Embedded at build time so
// `vg-local --version` works without reading from disk at runtime.
const VG_LOCAL_VERSION = '1.7.1';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printUsage();
    return 0;
  }

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    process.stdout.write(`vg-local ${VG_LOCAL_VERSION}\n`);
    return 0;
  }

  if (cmd === 'init') {
    return runInit(argv.slice(1));
  }

  if (cmd === 'analyze') {
    const result = await runAnalyze(argv.slice(1));
    return result.exitCode;
  }

  if (cmd === 'install-skill') {
    const result = await runInstallSkill(argv.slice(1));
    return result.exitCode;
  }

  process.stderr.write(`vg-local: unknown command "${cmd}"\n\n`);
  printUsage();
  return 2;
}

function printUsage(): void {
  process.stdout.write(`vg-local — VibeGuard SQL safety analyzer

USAGE
  vg-local <command> [options]

COMMANDS
  init                       Scaffold an example SQL file and an
                             "npm run lint:sql" script.
  analyze <glob>...          Analyze SQL files matching one or more
                             glob patterns. Exits non-zero if any
                             block-severity catch fires.
                             Supports --format=human|jsonl|ndjson|reflect,
                             --stdin, --reflect, --fix, --fix-dry-run.
  install-skill              Auto-detect agent harnesses (Claude Code,
                             Cursor, aider) and install the
                             vibeguard-sql-safety SKILL.md into each.

OPTIONS
  -h, --help                 Show this help.
  -v, --version              Show the SDK version.

EXAMPLES
  vg-local init
  vg-local analyze 'src/**/*.sql'
  vg-local analyze 'migrations/*.sql' 'src/**/*.sql'
  echo "$SQL" | vg-local analyze --stdin --format=jsonl
  vg-local install-skill                  # interactive
  vg-local install-skill --yes            # non-interactive
  vg-local install-skill --target=claude-user --with-memory=user
`);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`vg-local: ${msg}\n`);
    process.exit(1);
  });
