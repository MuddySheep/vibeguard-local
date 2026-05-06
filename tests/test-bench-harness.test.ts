import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MIN_ABSOLUTE_DELTA_US,
  DEFAULT_REGRESSION_THRESHOLD,
  detectRegressions,
  formatRegressionReport,
  type BenchReport,
  type FixtureResult,
} from '../benchmarks/lib/regression.js';

// STORY 4.1 — bench harness regression detector tests.
//
// The detector is the close-out gate the harness uses to fail CI on
// performance regressions. We test the comparison logic directly with
// hand-crafted before/after fixture results — no actual bench
// invocation required.

function makeBaseline(results: FixtureResult[]): BenchReport {
  return {
    node: 'v20.0.0',
    platform: 'linux',
    timestamp: '2026-05-06T00:00:00.000Z',
    iterations: 2000,
    warmup: 200,
    results,
  };
}

function fix(
  category: string,
  name: string,
  meanUs: number,
): FixtureResult {
  return {
    category,
    name,
    iterations: 2000,
    mean_us: meanUs,
    p50_us: meanUs * 0.9,
    p95_us: meanUs * 1.5,
    p99_us: meanUs * 2,
    min_us: meanUs * 0.5,
    max_us: meanUs * 5,
  };
}

describe('detectRegressions — passes', () => {
  it('passes when current is identical to baseline', () => {
    const baseline = makeBaseline([fix('small', 'a', 100)]);
    const cmp = detectRegressions([fix('small', 'a', 100)], baseline);
    expect(cmp.passed).toBe(true);
    expect(cmp.regressions).toHaveLength(0);
  });

  it('passes when current is faster than baseline', () => {
    const baseline = makeBaseline([fix('small', 'a', 100)]);
    const cmp = detectRegressions([fix('small', 'a', 50)], baseline);
    expect(cmp.passed).toBe(true);
    expect(cmp.regressions).toHaveLength(0);
  });

  it('passes when current is slightly slower but under threshold (15%)', () => {
    // 15% slowdown vs default 20% threshold → no regression
    const baseline = makeBaseline([fix('small', 'a', 100)]);
    const cmp = detectRegressions([fix('small', 'a', 115)], baseline);
    expect(cmp.passed).toBe(true);
  });

  it('passes exactly at the threshold boundary (20.0%)', () => {
    // ratio = 1.20, threshold rejects > 1.20, so 1.20 itself passes
    const baseline = makeBaseline([fix('small', 'a', 100)]);
    const cmp = detectRegressions([fix('small', 'a', 120)], baseline);
    expect(cmp.passed).toBe(true);
  });
});

describe('detectRegressions — fails', () => {
  it('fails when current is 25% slower than baseline (with delta above noise floor)', () => {
    // baseline 1000µs → current 1250µs: delta 250µs > 50µs floor,
    // ratio 1.25 > 1.20 threshold — registers as regression.
    const baseline = makeBaseline([fix('large', 'a', 1000)]);
    const cmp = detectRegressions([fix('large', 'a', 1250)], baseline);
    expect(cmp.passed).toBe(false);
    expect(cmp.regressions).toHaveLength(1);
    expect(cmp.regressions[0]?.fixtureKey).toBe('large/a');
    expect(cmp.regressions[0]?.ratio).toBeCloseTo(1.25, 5);
  });

  it('fails when current is 200% slower than baseline', () => {
    const baseline = makeBaseline([fix('large', 'big', 1000)]);
    const cmp = detectRegressions([fix('large', 'big', 3000)], baseline);
    expect(cmp.passed).toBe(false);
    expect(cmp.regressions[0]?.ratio).toBeCloseTo(3, 5);
  });

  it('reports all regressions, not just the first', () => {
    const baseline = makeBaseline([
      fix('medium', 'a', 200),
      fix('medium', 'b', 200),
      fix('large', 'c', 500),
    ]);
    const current: FixtureResult[] = [
      fix('medium', 'a', 300), // +50%, delta 100µs — regression
      fix('medium', 'b', 210), // +5%, below threshold — fine
      fix('large', 'c', 700), // +40%, delta 200µs — regression
    ];
    const cmp = detectRegressions(current, baseline);
    expect(cmp.passed).toBe(false);
    expect(cmp.regressions).toHaveLength(2);
    const keys = cmp.regressions.map((r) => r.fixtureKey).sort();
    expect(keys).toEqual(['large/c', 'medium/a']);
  });
});

describe('detectRegressions — noise floor', () => {
  it('suppresses sub-floor absolute deltas even when % threshold is breached', () => {
    // baseline 30µs → current 60µs: ratio 2.0 (100% slower!) but
    // delta 30µs < 50µs floor → suppressed (microsecond-scale noise).
    const baseline = makeBaseline([fix('small', 'tiny', 30)]);
    const cmp = detectRegressions([fix('small', 'tiny', 60)], baseline);
    expect(cmp.passed).toBe(true);
    expect(cmp.regressions).toHaveLength(0);
  });

  it('honors a custom (lower) noise floor', () => {
    const baseline = makeBaseline([fix('small', 'tiny', 30)]);
    // With floor=10us, delta=30us > 10us → ratio check applies → fires.
    const cmp = detectRegressions(
      [fix('small', 'tiny', 60)],
      baseline,
      DEFAULT_REGRESSION_THRESHOLD,
      10,
    );
    expect(cmp.passed).toBe(false);
  });

  it('exposes the default noise floor as 100µs', () => {
    expect(DEFAULT_MIN_ABSOLUTE_DELTA_US).toBe(100);
  });
});

describe('detectRegressions — fixture set evolution', () => {
  it('reports new fixtures (in current, missing from baseline) without failing', () => {
    const baseline = makeBaseline([fix('small', 'a', 100)]);
    const cmp = detectRegressions(
      [fix('small', 'a', 100), fix('small', 'new', 50)],
      baseline,
    );
    expect(cmp.passed).toBe(true);
    expect(cmp.newFixtures).toEqual(['small/new']);
  });

  it('reports missing fixtures (in baseline, missing from current) without failing', () => {
    const baseline = makeBaseline([
      fix('small', 'a', 100),
      fix('small', 'old', 50),
    ]);
    const cmp = detectRegressions([fix('small', 'a', 100)], baseline);
    expect(cmp.passed).toBe(true);
    expect(cmp.missingFixtures).toEqual(['small/old']);
  });

  it('reports both new and missing in the same run', () => {
    const baseline = makeBaseline([
      fix('small', 'a', 100),
      fix('small', 'old', 50),
    ]);
    const cmp = detectRegressions(
      [fix('small', 'a', 100), fix('small', 'new', 75)],
      baseline,
    );
    expect(cmp.newFixtures).toEqual(['small/new']);
    expect(cmp.missingFixtures).toEqual(['small/old']);
  });
});

describe('detectRegressions — defensive cases', () => {
  it('skips fixtures whose baseline mean is zero (avoids divide-by-zero)', () => {
    const baseline = makeBaseline([fix('small', 'zero', 0)]);
    const cmp = detectRegressions([fix('small', 'zero', 100)], baseline);
    expect(cmp.passed).toBe(true);
    expect(cmp.regressions).toHaveLength(0);
  });

  it('honors a custom (tighter) threshold above the noise floor', () => {
    // baseline 1000µs → current 1100µs: delta 100µs (above 50µs floor),
    // ratio 1.10 — passes the default 20% threshold but fails a tight 3%.
    const baseline = makeBaseline([fix('large', 'a', 1000)]);
    const tight = detectRegressions(
      [fix('large', 'a', 1100)],
      baseline,
      0.03, // 3% threshold
    );
    expect(tight.passed).toBe(false);
  });

  it('exposes the default threshold as 20%', () => {
    expect(DEFAULT_REGRESSION_THRESHOLD).toBeCloseTo(0.2, 5);
  });
});

describe('formatRegressionReport', () => {
  it('formats the green path concisely', () => {
    const report = detectRegressions(
      [fix('small', 'a', 100)],
      makeBaseline([fix('small', 'a', 100)]),
    );
    expect(formatRegressionReport(report)).toContain('No regressions');
  });

  it('formats failures with fixture key and percentage', () => {
    // Delta must clear the 100µs noise floor for the regression to
    // register; use 1000µs baseline → 1500µs current.
    const report = detectRegressions(
      [fix('large', 'a', 1500)],
      makeBaseline([fix('large', 'a', 1000)]),
    );
    const out = formatRegressionReport(report);
    expect(out).toContain('REGRESSIONS');
    expect(out).toContain('large/a');
    expect(out).toContain('+50.0%');
  });

  it('mentions new and missing fixtures when present', () => {
    const report = detectRegressions(
      [fix('small', 'a', 100), fix('small', 'new', 75)],
      makeBaseline([fix('small', 'a', 100), fix('small', 'old', 50)]),
    );
    const out = formatRegressionReport(report);
    expect(out).toContain('New fixtures');
    expect(out).toContain('small/new');
    expect(out).toContain('Missing fixtures');
    expect(out).toContain('small/old');
  });
});
