// Full bench-regression harness for @vibeguard-dev/local.
//
// STORY 4.1 — replaces the Week-1 skeleton with a real harness that:
//   - Loads .sql fixtures from benchmarks/fixtures/{small,medium,large,catches}/
//   - Benches each fixture with WARMUP+ITERATIONS pacing
//   - Emits a structured JSON report to benchmarks/results/<timestamp>.json
//   - Compares against benchmarks/baseline.json via the regression
//     detector in benchmarks/lib/regression.ts
//   - Exits non-zero on >20% mean-latency regression (DEFAULT_REGRESSION_
//     THRESHOLD) for ANY fixture
//   - Honors `--update-baseline` to write the current run as the new
//     baseline (operator-only between minor versions)
//
// The regression detector is a separate module so its logic can be
// unit-tested without invoking the full bench. See benchmarks/lib/
// regression.ts and tests/test-bench-harness.test.ts.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, init } from '../src/index.js';

import {
  DEFAULT_REGRESSION_THRESHOLD,
  detectRegressions,
  formatRegressionReport,
  type BenchReport,
  type FixtureResult,
} from './lib/regression.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const BASELINE_PATH = join(__dirname, 'baseline.json');
const RESULTS_DIR = join(__dirname, 'results');

const ITERATIONS = 2000;
const WARMUP = 200;
/**
 * Sanity bound: any fixture whose p99 exceeds this is a release-blocking
 * red flag regardless of baseline regression status. 5ms is intentionally
 * loose — a typical fixture takes <500us.
 */
const SANITY_BOUND_US = 5_000;

interface Fixture {
  readonly name: string;
  readonly category: string;
  readonly sql: string;
}

/**
 * Walk benchmarks/fixtures/<category>/*.sql and return all fixtures
 * tagged with their containing-directory category.
 */
function discoverFixtures(): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  const fixtures: Fixture[] = [];
  for (const cat of readdirSync(FIXTURES_DIR)) {
    const catDir = join(FIXTURES_DIR, cat);
    if (!statSync(catDir).isDirectory()) continue;
    for (const file of readdirSync(catDir)) {
      if (!file.endsWith('.sql')) continue;
      const name = file.replace(/\.sql$/, '');
      const sql = readFileSync(join(catDir, file), 'utf8');
      fixtures.push({ name, category: cat, sql });
    }
  }
  // Stable ordering for deterministic output.
  fixtures.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
  return fixtures;
}

function bench(name: string, category: string, fn: () => void): FixtureResult {
  for (let i = 0; i < WARMUP; i++) fn();

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1000); // microseconds
  }

  samples.sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    name,
    category,
    iterations: ITERATIONS,
    mean_us: sum / samples.length,
    p50_us: samples[Math.floor(samples.length * 0.5)] ?? 0,
    p95_us: samples[Math.floor(samples.length * 0.95)] ?? 0,
    p99_us: samples[Math.floor(samples.length * 0.99)] ?? 0,
    min_us: samples[0] ?? 0,
    max_us: samples[samples.length - 1] ?? 0,
  };
}

function formatTable(results: readonly FixtureResult[]): string {
  const lines: string[] = [];
  lines.push(
    [
      'fixture'.padEnd(38),
      'mean'.padStart(8),
      'p50'.padStart(8),
      'p95'.padStart(8),
      'p99'.padStart(8),
      'min'.padStart(8),
      'max'.padStart(8),
    ].join('  '),
  );
  for (const r of results) {
    lines.push(
      [
        `${r.category}/${r.name}`.padEnd(38),
        r.mean_us.toFixed(1).padStart(8),
        r.p50_us.toFixed(1).padStart(8),
        r.p95_us.toFixed(1).padStart(8),
        r.p99_us.toFixed(1).padStart(8),
        r.min_us.toFixed(1).padStart(8),
        r.max_us.toFixed(1).padStart(8),
      ].join('  '),
    );
  }
  return lines.join('\n');
}

function buildReport(results: readonly FixtureResult[]): BenchReport {
  return {
    node: process.version,
    platform: process.platform,
    timestamp: new Date().toISOString(),
    iterations: ITERATIONS,
    warmup: WARMUP,
    results,
  };
}

async function main(): Promise<void> {
  const updateBaseline = process.argv.includes('--update-baseline');

  await init();

  const fixtures = discoverFixtures();
  if (fixtures.length === 0) {
    console.error(`bench: no fixtures found in ${FIXTURES_DIR}`);
    process.exit(1);
  }
  console.log(
    `Bench: ${fixtures.length} fixtures across ` +
      `${new Set(fixtures.map((f) => f.category)).size} categories`,
  );
  console.log(
    `Iterations: ${ITERATIONS} (warmup: ${WARMUP}); ` +
      `Threshold: ${(DEFAULT_REGRESSION_THRESHOLD * 100).toFixed(0)}% mean-latency regression\n`,
  );

  const results: FixtureResult[] = [];
  for (const f of fixtures) {
    results.push(bench(f.name, f.category, () => analyze(f.sql)));
  }

  console.log(formatTable(results));
  console.log('');

  // Sanity-bound check: every fixture's p99 must be under 5ms.
  const sanityFailures = results.filter((r) => r.p99_us > SANITY_BOUND_US);
  if (sanityFailures.length > 0) {
    console.error('SANITY BOUND EXCEEDED (p99 > 5000us):');
    for (const r of sanityFailures) {
      console.error(`  ${r.category}/${r.name}: p99=${r.p99_us.toFixed(1)}us`);
    }
    process.exit(1);
  }

  // Persist a per-run report.
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const report = buildReport(results);
  const outPath = join(RESULTS_DIR, `${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Wrote per-run report: ${outPath}`);

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Updated baseline: ${BASELINE_PATH}`);
    return;
  }

  // Compare against baseline.
  if (!existsSync(BASELINE_PATH)) {
    console.warn(
      'No baseline.json found — skipping regression check. ' +
        'Run `npm run bench:update-baseline` to create one.',
    );
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BenchReport;
  const cmp = detectRegressions(results, baseline);
  console.log(formatRegressionReport(cmp));
  if (!cmp.passed) {
    process.exit(1);
  }
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('bench failed:', err);
  process.exit(1);
});
