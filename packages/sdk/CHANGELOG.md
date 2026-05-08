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

## [1.2.0] - 2026-05-07

First-run CLI experience. Adds the `vg-local` binary with `init` and
`analyze` subcommands. No SDK API surface changes; the `analyze()`
function and the rule registry behave identically to V1.1.

### Added

- **`vg-local init`** — first-run scaffolder. Creates a
  `vibeguard.example.sql` file with a deliberate SQL-003 catch, adds
  an `npm run lint:sql` script to your `package.json`, runs the
  analyzer on the example, and prints the catch in colored output.
  Idempotent — re-running detects existing state and leaves it
  untouched. Smart about missing or malformed `package.json`.
- **`vg-local analyze <glob>...`** — file-globbing analyzer. Resolves
  one or more glob patterns to file paths, runs `analyze()` on each,
  prints catches per file with severity coloring, and exits non-zero
  if any `block`-severity catch fires. CI-friendly. Glob expansion
  via `tinyglobby`. Files larger than 5 MB are skipped with a stderr
  warning. Parse errors per file are reported via stderr without
  stopping the run.
- **`vg-local --version` / `-v`** — print the SDK version.
- **`vg-local --help` / `-h`** — print usage.
- **`bin: { "vg-local": "./dist/cli/index.js" }`** in `package.json`.
  Use via `npx @vibeguard-dev/local <subcommand>` or, after install,
  via `npm run lint:sql` (auto-added by `init`).
- README Quickstart now leads with the `npx @vibeguard-dev/local init`
  one-shot path before the programmatic API.

### Changed

- **Build now produces two output trees:** `dist/index.{js,cjs,d.ts,d.cts}`
  for the library entry (unchanged) and `dist/cli/index.{js,cjs}` for
  the CLI entry. The library bundle does NOT carry a shebang; the
  CLI bundle does. tsup config switched to a two-config array to
  keep the shebang banner scoped to the CLI build only.
- **New runtime dependencies:** `picocolors@^1.1.1` (~1.5 KB,
  TTY-aware ANSI coloring) and `tinyglobby@^0.2.10` (~50 KB, glob
  expansion). Both are widely used in the Vite/tsup/vitest ecosystem;
  net install footprint impact is small.
- Test count: **416 → 452.** +13 format, +14 init (incl. idempotency,
  no-package.json, malformed-package.json), +9 analyze (exit codes,
  glob expansion, error handling, opt-in plumbing).

### Architecture notes

- `runInit(args, options)` and `runAnalyze(args, options)` accept
  `cwd` and io streams as parameters (defaulting to `process.cwd()` /
  `process.stdout` / `process.stderr` at the CLI boundary). Pure
  inputs make the functions testable from worker threads (where
  `process.chdir()` isn't allowed) and callable from custom
  integrations.
- Arg parsing is hand-rolled. The CLI surface is tiny; the cost of
  shipping `mri` / `cac` would exceed the cost of the parser.

### Migration notes

V1.1 → V1.2 is fully backwards compatible. The library API surface
is unchanged. `npm install @vibeguard-dev/local libpg-query`
installs the new CLI alongside the library; `vg-local` becomes
available in your project's `node_modules/.bin/`.

## [1.1.0] - 2026-05-07

Three new catches plus the per-rule override mechanism that supports
default-OFF rules. Headline jumps from 12 catches to 15.

### Added

- **`SQL-013` — Destructive DDL.** Catches `DROP TABLE`, `DROP DATABASE`,
  `DROP SCHEMA` (with or without `CASCADE`), and `TRUNCATE` at
  `block` severity / confidence 99. Catches `DROP INDEX` at the
  softer `warn` / 85 because index drops are routinely-legitimate
  schema maintenance. Distinct from SQL-003 (DML); DDL has no
  `WHERE` clause possibility, so the verdict is unambiguous.
- **`SQL-014` — INSERT / UPDATE / DELETE without RETURNING.** Fires
  at `info` / confidence 50 when a write statement omits a
  `RETURNING` clause. **Default OFF** — opt in via the new
  `AnalyzeOptions.rules` option. Most useful when an agent's
  prompts ask for the affected row back ("create a user and tell
  me the new id").
- **`SQL-015` — `SELECT *` over-fetch.** Catches bare `SELECT *` and
  qualified `SELECT t.*` projections (in top-level SELECTs, CTEs,
  subqueries, and the right side of UNION / INTERSECT / EXCEPT) at
  `info` / confidence 60. Schema-blind by design — does not use
  schema metadata to refine the verdict (that lives in the cloud
  product). Default ON. Function-argument stars (`COUNT(*)` and
  similar aggregates) are deliberately NOT caught.
- **`AnalyzeOptions.rules` — per-rule enable / disable.** New
  optional field on the `analyze()` options bag. Use to opt in to
  default-OFF rules or to disable default-ON rules for a single
  call. Match is case-insensitive on catch codes:
  ```ts
  analyze(sql, { rules: { 'sql-014': { enabled: true } } });
  analyze(sql, { rules: { 'sql-007': { enabled: false } } });
  ```
- **`RULE_REGISTRY` — metadata-bearing rule registry.** New top-level
  export. Each entry has `{ code, rule, defaultEnabled }`. Use to
  enumerate every rule the SDK ships, including default-OFF ones.
  The pre-existing `RULES` export remains and contains the
  default-enabled subset in registry order — backwards compatible
  with V1.0 advanced consumers using `runRules(ast, RULES)`.
- **`RuleEntry` type.** Public type for `RULE_REGISTRY` entries.
- Three new docs pages:
  [`docs/rules/sql-013.md`](./docs/rules/sql-013.md),
  [`docs/rules/sql-014.md`](./docs/rules/sql-014.md),
  [`docs/rules/sql-015.md`](./docs/rules/sql-015.md).

### Changed

- **`RULES.length` is now 14, was 12.** SQL-013 and SQL-015 are
  default-on and joined the registry; SQL-014 is default-off and is
  in `RULE_REGISTRY` only. Per STABILITY.md this is a minor-version
  event ("Detection-logic improvements are minor versions"); no
  consumer code that does `for (const r of RULES) { ... }` breaks.
- README catch table updated from 12 to 15 rows. New `Default`
  column makes the OFF state of SQL-014 explicit.
- Test count: **317 → 416.** +30 SQL-013, +24 SQL-014, +26 SQL-015,
  +19 for the `AnalyzeOptions.rules` plumbing.

### Migration notes

V1.0 → V1.1 is fully backwards compatible. No public types changed;
no exports were removed or renamed. The new exports (`RULE_REGISTRY`,
`RuleEntry`, the `rules` field on `AnalyzeOptions`) are additive.

Customers running the public default path (`analyze(sql)`) will start
seeing `SQL-013` and `SQL-015` catches on queries that previously
returned empty `catches` arrays — that is the intended behavior. To
suppress either rule for a single call, use `options.rules`:

```ts
analyze(sql, { rules: { 'sql-015': { enabled: false } } });
```

## [1.0.2] - 2026-05-06

Documentation patch — README's quickstart now matches what the SDK
actually does at runtime.

### Fixed

- **Quickstart now includes the required `await init()` call.**
  `init()` is a one-time async bootstrap for the libpg-query WASM
  parser; calling `analyze()` before init returns a `parseError`.
  The 1.0.0 / 1.0.1 README omitted this step, so anyone copying the
  example verbatim would hit a confusing "parser not initialized"
  error. Both ESM and CJS variants now show the full bootstrap.
- **Quickstart sample output corrected.** SQL-003 fires at confidence
  99 for UPDATE (97 for DELETE), not 95 as the older example showed.
  Detail / fix prose now matches the actual catch output.
- **CI badge URL fixed.** Status badge points at
  `github.com/MuddySheep/vibeguard-local` instead of the original
  `TODO-org/TODO-repo` placeholder. The image now displays correctly
  on the npm package page and on the GitHub repo.

### Added

- CommonJS quickstart example alongside the ESM one. Verified
  end-to-end against the registry — `require('@vibeguard-dev/local')`
  loads cleanly, fires all 12 catches with correct severity/
  confidence on canonical positive cases.

## [1.0.1] - 2026-05-06

Patch release.

### Fixed

- **CJS resolution.** The `1.0.0` CJS bundle compiled
  `createRequire(import.meta.url)` to `createRequire(undefined)`
  because tsup didn't shim `import.meta.url` for CJS output by
  default. Net effect: `require('@vibeguard-dev/local')` consumers
  hit a spurious *"requires libpg-query as a peer dependency"* error
  even when libpg-query was correctly installed. Fixed by enabling
  `shims: true` in `tsup.config.ts`. ESM users were unaffected.
  Caught via post-publish smoke; affected anyone pulling the SDK
  via CommonJS.

### Changed

- `package.json`: `homepage`, `bugs.url`, `repository.url`, and
  `author` updated from the original placeholder values to the
  actual public repo URLs (`github.com/MuddySheep/vibeguard-local`).
  The npm package page's "Repository" link now resolves correctly.

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
