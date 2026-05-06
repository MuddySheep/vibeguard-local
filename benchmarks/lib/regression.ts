// Regression detector for the bench harness.
//
// Extracted into its own module so the comparison logic can be unit-
// tested without spinning up the full bench. The bench harness imports
// `detectRegressions` and uses it as the close-out gate; `tests/test-
// bench-harness.test.ts` imports the same function and verifies its
// behavior with hand-crafted before/after numbers.

/**
 * One fixture's bench result. Mirrors the shape written to baseline.json
 * and per-run results files.
 */
export interface FixtureResult {
  readonly name: string;
  readonly category: string;
  readonly iterations: number;
  readonly mean_us: number;
  readonly p50_us: number;
  readonly p95_us: number;
  readonly p99_us: number;
  readonly min_us: number;
  readonly max_us: number;
}

/**
 * Top-level shape of `benchmarks/baseline.json` and per-run files.
 */
export interface BenchReport {
  readonly node: string;
  readonly platform: string;
  readonly timestamp: string;
  readonly iterations: number;
  readonly warmup: number;
  readonly results: readonly FixtureResult[];
}

/**
 * One regression entry — emitted when a current run's mean latency
 * exceeds the baseline's by more than the configured threshold.
 */
export interface Regression {
  readonly fixtureKey: string;
  readonly baselineMeanUs: number;
  readonly currentMeanUs: number;
  /** Ratio of current/baseline (e.g. 1.25 = 25% slower). */
  readonly ratio: number;
}

export interface RegressionReport {
  readonly passed: boolean;
  readonly regressions: readonly Regression[];
  /** Fixtures present in current run but missing from baseline (informational). */
  readonly newFixtures: readonly string[];
  /** Fixtures present in baseline but missing from current (informational). */
  readonly missingFixtures: readonly string[];
}

/**
 * Default regression threshold: 20% slower than baseline triggers a
 * fail. Loose enough to absorb CI variance, tight enough to catch
 * meaningful regressions from new rules / refactors.
 */
export const DEFAULT_REGRESSION_THRESHOLD = 0.2;

/**
 * Minimum absolute mean-latency delta (microseconds) required for a
 * regression to register. Run-to-run system noise on real hardware
 * easily produces 25–80% relative variance with no code change at
 * sub-300µs fixture sizes. The absolute floor suppresses those noise
 * spikes: a regression must exceed BOTH the percentage threshold
 * AND this absolute delta to count.
 *
 * 100µs is the empirically-stable floor in mixed Windows + Linux CI
 * runs against this SDK's fixture set. Real regressions from new
 * rules / substrate changes show up as 100µs+ deltas across many
 * fixtures simultaneously — well above this floor on medium/large
 * fixtures (which sit at 200–1000µs baselines). Small-fixture-only
 * regressions under 100µs absolute are indistinguishable from noise
 * and are accepted as the cost of stable CI gating.
 */
export const DEFAULT_MIN_ABSOLUTE_DELTA_US = 100;

/**
 * Compare the current run's results against a baseline and return a
 * structured regression report. Pure function — no I/O.
 *
 * @param current  - the new bench run's results
 * @param baseline - the recorded baseline
 * @param threshold - fractional slowdown that counts as a regression
 *                    (0.2 = 20%; the default)
 * @param minAbsoluteDeltaUs - absolute mean-delta floor in microseconds.
 *                    Regressions below this floor are suppressed even
 *                    if they exceed the percentage threshold. Default
 *                    50µs.
 *
 * Pairs fixtures by `${category}/${name}`. Fixtures present in only
 * one side are surfaced as `newFixtures` / `missingFixtures` but
 * don't fail the report.
 */
export function detectRegressions(
  current: readonly FixtureResult[],
  baseline: BenchReport,
  threshold: number = DEFAULT_REGRESSION_THRESHOLD,
  minAbsoluteDeltaUs: number = DEFAULT_MIN_ABSOLUTE_DELTA_US,
): RegressionReport {
  const baselineByKey = new Map<string, FixtureResult>();
  for (const r of baseline.results) {
    baselineByKey.set(`${r.category}/${r.name}`, r);
  }

  const regressions: Regression[] = [];
  const newFixtures: string[] = [];
  const seenBaselineKeys = new Set<string>();

  for (const r of current) {
    const key = `${r.category}/${r.name}`;
    const b = baselineByKey.get(key);
    if (!b) {
      newFixtures.push(key);
      continue;
    }
    seenBaselineKeys.add(key);
    // Defensive: avoid divide-by-zero on a baseline mean of 0us
    // (vanishingly rare but possible on cached parses or no-op rules).
    if (b.mean_us <= 0) continue;
    const absoluteDelta = r.mean_us - b.mean_us;
    if (absoluteDelta < minAbsoluteDeltaUs) continue; // noise floor
    const ratio = r.mean_us / b.mean_us;
    if (ratio > 1 + threshold) {
      regressions.push({
        fixtureKey: key,
        baselineMeanUs: b.mean_us,
        currentMeanUs: r.mean_us,
        ratio,
      });
    }
  }

  const missingFixtures: string[] = [];
  for (const key of baselineByKey.keys()) {
    if (!seenBaselineKeys.has(key)) missingFixtures.push(key);
  }

  return {
    passed: regressions.length === 0,
    regressions,
    newFixtures,
    missingFixtures,
  };
}

/**
 * Format a RegressionReport as a human-readable multi-line string for
 * stderr / CI logs. Used by the bench harness on failure; tests
 * assert the format stays stable.
 */
export function formatRegressionReport(report: RegressionReport): string {
  const lines: string[] = [];
  if (report.regressions.length > 0) {
    lines.push('REGRESSIONS DETECTED:');
    for (const r of report.regressions) {
      const pct = ((r.ratio - 1) * 100).toFixed(1);
      lines.push(
        `  ${r.fixtureKey}: ${r.baselineMeanUs.toFixed(1)}us → ` +
          `${r.currentMeanUs.toFixed(1)}us (+${pct}%)`,
      );
    }
  } else {
    lines.push('No regressions vs baseline.');
  }
  if (report.newFixtures.length > 0) {
    lines.push(`New fixtures (informational): ${report.newFixtures.join(', ')}`);
  }
  if (report.missingFixtures.length > 0) {
    lines.push(
      `Missing fixtures vs baseline: ${report.missingFixtures.join(', ')}`,
    );
  }
  return lines.join('\n');
}
