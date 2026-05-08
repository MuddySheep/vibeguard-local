// `vg-local init` — first-run experience.
//
// What this does:
//   1. Detect the working directory's project shape (package.json
//      present? what's the script object look like?).
//   2. Create a `vibeguard.example.sql` file with a deliberate
//      SQL-003 unbounded-UPDATE catch — the canonical "oh no" shape.
//      Skip if the file already exists; never overwrite user state.
//   3. Add an `npm run lint:sql` script to package.json that points
//      at the example. Skip if the script already exists.
//   4. Run analyze() on the example and print the colored result so
//      the operator sees what a catch looks like immediately.
//   5. Suggest `npm run lint:sql` as the next step.
//
// Tone: deliberately understated. One example, one fix, one next
// step. The first-run message is brand-sensitive; the copy here is
// the load-bearing one.
//
// Idempotent: running `vg-local init` twice is safe. The second run
// reports what's already there and re-runs the analyzer, but doesn't
// overwrite or duplicate anything.
//
// Pure inputs: `cwd` and the io streams are passed in (defaulting
// to process.cwd() / stdout / stderr at the CLI boundary). This
// keeps the function testable from worker threads where
// process.chdir() is not allowed.

import { promises as fs } from 'node:fs';
import path from 'node:path';

import pc from 'picocolors';

import { analyze, init as initParser } from '../index.js';
import { formatCatch } from './format.js';

const EXAMPLE_FILENAME = 'vibeguard.example.sql';
const SCRIPT_NAME = 'lint:sql';
// No quotes around the filename — bash strips single quotes but cmd.exe
// doesn't, so a quoted literal works on Linux/macOS and fails on Windows
// (npm scripts run via cmd by default). Bare path is portable for files
// without spaces; users writing their own globs handle their own shell
// quoting.
const SCRIPT_COMMAND = `vg-local analyze ${EXAMPLE_FILENAME}`;

const EXAMPLE_SQL = `-- VibeGuard example. Run \`npm run ${SCRIPT_NAME}\` to see the catch.
-- This is the canonical SQL-003 (unbounded UPDATE) shape — every row
-- in the table would be modified. Add a WHERE clause to scope it.
UPDATE users SET email = 'hello@example.com';
`;

interface PackageJsonShape {
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export interface RunInitOptions {
  /** Working directory. Defaults to process.cwd() at the CLI boundary. */
  readonly cwd?: string;
  /** Stdout sink. Defaults to process.stdout. */
  readonly out?: NodeJS.WritableStream;
}

/**
 * `vg-local init` entry point. Returns 0 on success.
 */
export async function runInit(
  _args: readonly string[],
  options: RunInitOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? process.stdout;

  // 1. Detect package.json
  const pkgPath = path.join(cwd, 'package.json');
  let pkg: PackageJsonShape | null = null;
  let pkgRaw = '';
  try {
    pkgRaw = await fs.readFile(pkgPath, 'utf8');
    pkg = JSON.parse(pkgRaw) as PackageJsonShape;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // package.json exists but couldn't be parsed — surface but don't crash
      out.write(
        pc.yellow(
          `Warning: package.json found but could not be parsed (${
            (err as Error).message
          }). Skipping the npm script step.\n`,
        ),
      );
    }
  }

  // 2. Create example file
  const examplePath = path.join(cwd, EXAMPLE_FILENAME);
  let exampleCreated = false;
  try {
    await fs.access(examplePath);
    // already exists — leave it alone
  } catch {
    await fs.writeFile(examplePath, EXAMPLE_SQL, 'utf8');
    exampleCreated = true;
  }

  // 3. Add npm script (only if package.json exists and is parseable)
  let scriptAdded = false;
  if (pkg) {
    const scripts = pkg.scripts ?? {};
    if (!scripts[SCRIPT_NAME]) {
      pkg.scripts = { ...scripts, [SCRIPT_NAME]: SCRIPT_COMMAND };
      // Preserve trailing newline if the original had one.
      const trailing = pkgRaw.endsWith('\n') ? '\n' : '';
      await fs.writeFile(
        pkgPath,
        JSON.stringify(pkg, null, 2) + trailing,
        'utf8',
      );
      scriptAdded = true;
    }
  }

  // 4. Run analyze() on the example and surface the catch.
  await initParser();
  const sql = await fs.readFile(examplePath, 'utf8');
  const result = analyze(sql);

  // 5. Print the report.
  out.write('\n');
  if (exampleCreated) {
    out.write(`${pc.green('Created')} ${pc.bold(EXAMPLE_FILENAME)}\n`);
  } else {
    out.write(
      pc.dim(`Found existing ${EXAMPLE_FILENAME} — left untouched.`) + '\n',
    );
  }
  if (scriptAdded) {
    out.write(
      `${pc.green('Created script')} ${pc.bold(`npm run ${SCRIPT_NAME}`)}\n`,
    );
  } else if (pkg && pkg.scripts?.[SCRIPT_NAME]) {
    out.write(
      pc.dim(
        `Script ${SCRIPT_NAME} already in package.json — left untouched.`,
      ) + '\n',
    );
  } else if (!pkg) {
    out.write(
      pc.dim(
        `No package.json found — skipped adding the ${SCRIPT_NAME} script.`,
      ) + '\n',
    );
  }

  out.write('\nRunning on the example...\n\n');
  for (const c of result.catches) {
    out.write(formatCatch(c, EXAMPLE_FILENAME) + '\n\n');
  }
  const catchWord = result.catches.length === 1 ? 'catch' : 'catches';
  out.write(`${result.catches.length} ${catchWord} in 1 file.\n\n`);

  if (scriptAdded || pkg?.scripts?.[SCRIPT_NAME]) {
    out.write(`${pc.dim('Try it:')} ${pc.bold(`npm run ${SCRIPT_NAME}`)}\n`);
  } else {
    // Bare filename — no quotes — so the same hint works in bash
    // and Windows cmd.
    out.write(
      `${pc.dim('Try it:')} ${pc.bold(`vg-local analyze ${EXAMPLE_FILENAME}`)}\n`,
    );
  }
  return 0;
}

// Exported for tests — lets the test harness assert on the canonical
// example content without having to re-derive it.
export const _internals = {
  EXAMPLE_FILENAME,
  EXAMPLE_SQL,
  SCRIPT_NAME,
  SCRIPT_COMMAND,
} as const;
