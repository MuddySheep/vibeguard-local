import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Cross-source invariant guard.
//
// The CLI's `vg-local --version` output is read from a hardcoded
// VG_LOCAL_VERSION literal in src/cli/index.ts (embedded at build
// time so the CLI doesn't read package.json from disk at runtime).
// That literal MUST match packages/sdk/package.json's `version` —
// otherwise the published CLI lies about its version.
//
// We caught this exact bug during the V1.4 smoke run: package.json
// was bumped 1.3.0 → 1.4.0 but the CLI literal stayed at '1.3.0',
// and the unit suite passed clean because no test asserted on this
// value. The published tarball would have shipped with a
// `vg-local 1.3.0` banner under a 1.4.0 package.
//
// This test makes the drift impossible:
//   - reads the CLI source as text
//   - regex-extracts the literal
//   - reads package.json
//   - asserts equality
//
// Failure mode: test fails. The right failure mode — anyone who
// changes one without the other has to fix it before the suite
// goes green again.

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = resolve(HERE, '..', 'package.json');
const CLI_SOURCE_PATH = resolve(HERE, '..', 'src', 'cli', 'index.ts');

interface PackageJson {
  readonly version: string;
}

describe('version sync', () => {
  it('VG_LOCAL_VERSION literal in src/cli/index.ts matches package.json version', () => {
    const pkgJsonText = readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const pkg = JSON.parse(pkgJsonText) as PackageJson;

    const cliSource = readFileSync(CLI_SOURCE_PATH, 'utf8');
    const match = cliSource.match(
      /const\s+VG_LOCAL_VERSION\s*=\s*['"]([^'"]+)['"]/,
    );

    expect(match, 'VG_LOCAL_VERSION literal not found in src/cli/index.ts').not.toBeNull();
    expect(match![1]).toBe(pkg.version);
  });

  it('package.json version is a sane semver-shaped string', () => {
    // Sanity check on the source-of-truth side. Catches accidental
    // edits like 1.4 / 1..4.0 / "1.4.0 " (trailing whitespace).
    const pkgJsonText = readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const pkg = JSON.parse(pkgJsonText) as PackageJson;
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });
});
