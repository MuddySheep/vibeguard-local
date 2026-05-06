# Changelog

All notable changes to `@vibeguard-dev/local` will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Stability rules are documented in [STABILITY.md](./STABILITY.md).

## [Unreleased]

Future changes will land here. New catches go through the proposal
process in [CONTRIBUTING.md](./CONTRIBUTING.md). Major versions ship
at most once a quarter; no surprise breaking changes.

## [1.0.0] - 2026-05-06

First stable release.

### Stability commitment

The contract in [STABILITY.md](./STABILITY.md) is binding from this
version forward:

- **Catch IDs are forever-stable.** Once `SQL-001` ships, that ID
  always means the same threat shape across all future versions.
  Retired IDs are gone forever, never reused.
- **Severity changes are major-version only.** A catch moving from
  `warn` to `block` (or back) is a major-version event. Customers
  shouldn't be surprised by a catch suddenly blocking what
  previously only warned.
- **Confidence range adjustments are minor versions.** Tightening
  or widening a catch's confidence range is acceptable in minor
  versions as detection accuracy improves.
- **Detection-logic improvements are minor versions.** Catching
  more edge cases or handling false positives better is a minor
  version bump — the catch's identity doesn't change.
- **Bug fixes are patch versions.** Pure bugs (panics, type
  errors, incorrect output structure) are patch.
- **Public API surface stays minimal.** Adding to the surface is a
  minor version. Removing or renaming anything in it is a major
  version.

### What's in 1.0.0

**Twelve catches** covering the most-cited SQL safety patterns:

- `SQL-001` — Cartesian explosion risk (block, 90–95)
- `SQL-002` — Self-join without disambiguating predicate (warn, 70–85)
- `SQL-003` — Unbounded UPDATE / DELETE statement (block, 95–99)
- `SQL-004` — Likely implicit type coercion in comparison (warn, 75–85)
- `SQL-005` — NULL comparison with `=` / `<>` (warn, 90–95)
- `SQL-006` — OFFSET without ORDER BY (warn, 85–95)
- `SQL-007` — NOT IN with potentially-nullable subquery (warn, 75–85)
- `SQL-008` — Possible string-concatenation injection (block, 80–95)
- `SQL-009` — DISTINCT applied to a star projection (info, 60–75)
- `SQL-010` — Correlated subquery in SELECT projection (warn, 70–85)
- `SQL-011` — Aggregate with non-aggregated column and no GROUP BY (warn, 85–95)
- `SQL-012` — Recursive CTE without obvious termination (block, 80–95)

**Public API:**

- `analyze(sql, options?)` — synchronous, throw-safe entry point
- `init()` — one-time async bootstrap for the libpg-query WASM parser
- Substrate helpers exported for users building their own static
  checks: `astWalk`, `extractFromTables`, `extractColumns`,
  `runRules`, `parseQuery`
- Public types: `Catch`, `AnalysisResult`, `Severity`,
  `ThreatCategory`, `Rule`, `ParseError`

**Integration examples** (each runnable, with own tests):

- `examples/claude-code/` — `generateSafeSQL(prompt, llm, options?)`
  retry-on-block wrapper around any LLM client
- `examples/cursor/` — `withVibeGuard(execute, options?)`
  execution-guard wrapper that filters block-severity catches before
  the database is touched
- `examples/replit-agent/` — `createVibeGuardHook(options?)`
  advisory-hook for agent runtimes that own their own retry loop

**Tooling:**

- Bench-regression harness with 37 fixtures across 4 categories
  (small / medium / large / per-catch positive cases), hard CI gate
  at >20% mean-latency regression with a 100µs absolute-delta noise
  floor
- `npm run bench:update-baseline` for operator-driven baseline
  refresh between minor versions
- Full TypeScript types, dual ESM + CJS build, size-budget enforced
  in CI (30KB gz ESM / 100KB raw CJS)

### Performance (Node 20.19.6)

Bundle size: ESM 8.5 KB gz / CJS 7.73 KB raw. Every fixture under
5ms p99 sanity bound; full distribution captured in
`benchmarks/baseline.json`.
