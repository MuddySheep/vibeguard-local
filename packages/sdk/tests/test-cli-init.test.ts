import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { _internals, runInit } from '../src/cli/init.js';
import { init } from '../src/index.js';

// V1.2 — init subcommand tests.
//
// runInit takes `cwd` as a parameter (defaulting to process.cwd() at
// the CLI boundary). Each test gets its own tmp dir; we pass it
// explicitly. No process.chdir() — that's not supported in vitest's
// worker threads anyway.
//
// stdout writes are captured via spy on process.stdout.write so we
// can assert on the rendered output. picocolors auto-disables ANSI
// codes when isatty=false (which is the test environment), so the
// captured strings are plain text and easy to match.

beforeAll(async () => {
  await init();
});

let tmpDir: string;
let stdoutCalls: string[];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vg-init-test-'));
  stdoutCalls = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutCalls.push(typeof chunk === 'string' ? chunk : chunk.toString());
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
});

function stdoutText(): string {
  return stdoutCalls.join('');
}

describe('runInit — fresh project (with package.json)', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        { name: 'demo', version: '0.0.1', scripts: { test: 'echo' } },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  });

  it('creates the example file', async () => {
    const code = await runInit([], { cwd: tmpDir });
    expect(code).toBe(0);

    const examplePath = path.join(tmpDir, _internals.EXAMPLE_FILENAME);
    const contents = await fs.readFile(examplePath, 'utf8');
    expect(contents).toBe(_internals.EXAMPLE_SQL);
  });

  it('adds the lint:sql npm script', async () => {
    await runInit([], { cwd: tmpDir });

    const pkg = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts['lint:sql']).toBe(_internals.SCRIPT_COMMAND);
    // Pre-existing script is preserved.
    expect(pkg.scripts.test).toBe('echo');
  });

  it('preserves existing JSON formatting (trailing newline)', async () => {
    await runInit([], { cwd: tmpDir });
    const pkgRaw = await fs.readFile(
      path.join(tmpDir, 'package.json'),
      'utf8',
    );
    expect(pkgRaw.endsWith('\n')).toBe(true);
  });

  it('runs analyze on the example and prints SQL-003', async () => {
    await runInit([], { cwd: tmpDir });
    const out = stdoutText();
    expect(out).toContain('SQL-003');
    expect(out).toContain('Unbounded UPDATE statement');
    expect(out).toContain('block · 99');
  });

  it('prints "Created" / "Created script" lines on first run', async () => {
    await runInit([], { cwd: tmpDir });
    const out = stdoutText();
    expect(out).toContain('Created');
    expect(out).toContain(_internals.EXAMPLE_FILENAME);
    expect(out).toContain(`npm run ${_internals.SCRIPT_NAME}`);
  });

  it('prints the "Try it: npm run lint:sql" footer', async () => {
    await runInit([], { cwd: tmpDir });
    expect(stdoutText()).toContain(`npm run ${_internals.SCRIPT_NAME}`);
  });
});

describe('runInit — idempotent re-run', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        { name: 'demo', version: '0.0.1', scripts: { test: 'echo' } },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    // First run to set state up
    await runInit([], { cwd: tmpDir });
    stdoutCalls = []; // reset capture for the second run
  });

  it('does not overwrite the example file', async () => {
    const examplePath = path.join(tmpDir, _internals.EXAMPLE_FILENAME);
    const userText = '-- user edited this\nSELECT 1;\n';
    await fs.writeFile(examplePath, userText, 'utf8');

    await runInit([], { cwd: tmpDir });

    expect(await fs.readFile(examplePath, 'utf8')).toBe(userText);
  });

  it('does not duplicate the lint:sql script', async () => {
    await runInit([], { cwd: tmpDir });
    const pkg = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8'),
    );
    expect(Object.keys(pkg.scripts).filter((k) => k === 'lint:sql')).toHaveLength(1);
  });

  it('reports "left untouched" on the second run', async () => {
    await runInit([], { cwd: tmpDir });
    const out = stdoutText();
    expect(out).toContain('left untouched');
  });
});

describe('runInit — no package.json', () => {
  it('still creates the example file', async () => {
    const code = await runInit([], { cwd: tmpDir });
    expect(code).toBe(0);

    const contents = await fs.readFile(
      path.join(tmpDir, _internals.EXAMPLE_FILENAME),
      'utf8',
    );
    expect(contents).toBe(_internals.EXAMPLE_SQL);
  });

  it('does not crash and explains the missing-package.json case', async () => {
    await runInit([], { cwd: tmpDir });
    const out = stdoutText();
    expect(out).toContain('No package.json');
    expect(out).toContain(`vg-local analyze ${_internals.EXAMPLE_FILENAME}`);
  });
});

describe('runInit — malformed package.json', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      '{ "name": "demo", malformed-here ',
      'utf8',
    );
  });

  it('does not crash; warns and proceeds', async () => {
    const code = await runInit([], { cwd: tmpDir });
    expect(code).toBe(0);

    const contents = await fs.readFile(
      path.join(tmpDir, _internals.EXAMPLE_FILENAME),
      'utf8',
    );
    expect(contents).toBe(_internals.EXAMPLE_SQL);
  });

  it('package.json is left as-is when unparseable', async () => {
    await runInit([], { cwd: tmpDir });
    const after = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
    expect(after).toContain('malformed-here');
  });
});
