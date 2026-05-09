// Permanent gallery-sample fire-test.
//
// For every sample in `SAMPLES`, the rule named in the sample's `code`
// MUST fire when that sample is analyzed. This catches the v1.6.0
// regression class where a sample's SQL was written in a shape the
// rule deliberately skips (e.g. SQL-008 with two pure-literal
// operands, or SQL-020 / SQL-033 with single-`$` dollar-quote
// delimiters that fail to parse).
//
// If you ADD a new sample, this test enforces that the sample
// actually demonstrates its catch. If you CHANGE a rule, this test
// enforces that the canonical demo still fires.
//
// Samples that need a default-OFF rule enabled (currently only
// SQL-014) signal that via `forceEnable` — the test honors it.

import { beforeAll, describe, expect, it } from 'vitest';

import { analyze, init } from '@vibeguard-dev/local';

import { SAMPLES } from '../src/samples.js';

beforeAll(async () => {
  await init();
});

describe('SAMPLES — every gallery sample fires its named rule', () => {
  for (const s of SAMPLES) {
    it(`${s.code} — sample analyzes and fires ${s.code}`, () => {
      const opts = s.forceEnable
        ? { rules: { [s.forceEnable]: { enabled: true } } }
        : undefined;
      const result = analyze(s.sql, opts);
      const codes = result.catches.map((c) => c.code);
      expect(
        codes,
        `expected ${s.code} to fire; actual catches: [${codes.join(', ') || '(none)'}]`,
      ).toContain(s.code);
    });
  }
});
