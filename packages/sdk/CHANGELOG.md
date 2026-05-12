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

## [1.7.1] - 2026-05-11

**Install-recipe fix + activation hardening.** No new catches, no
detection changes. This patch closes two real gaps in 1.7.0 that
landed in the same release: the README documented an install path
that didn't work, and the SKILL.md description was too soft to drive
deterministic activation in Claude Code.

### Fixed

- **`examples/agent-skill/SKILL.md` is now included in the npm
  tarball.** 1.7.0 excluded it via the `package.json` `files` field,
  which made the README's
  `cp node_modules/@vibeguard-dev/local/examples/agent-skill/SKILL.md ...`
  install recipe fail with "file not found" for every user who
  followed it. The tarball now ships the file at the same documented
  path. The manual `cp` recipe works as a fallback to the new
  install-skill subcommand.
- **SKILL.md `description` frontmatter rewritten.** Replaced soft
  "use whenever you are about to run SQL" prose with imperative
  "MANDATORY pre-flight for ALL SQL operations" + an explicit list
  of triggers (every Postgres verb, migrations, .sql files, RPC
  bodies, ORM raw-SQL escapes). Description-based skill routing in
  Claude Code is now significantly more likely to fire on
  SQL-shaped prompts. Combine with the new
  `install-skill --with-memory` flag for deterministic activation.
- **SKILL.md no longer claims `--reflect` is "expected in >= 1.8.0".**
  It shipped in 1.7.0; the SKILL.md body now references it correctly
  alongside the `--format=jsonl` recipe.

### Added

- **`vg-local install-skill` subcommand.** Auto-detects up to 5
  agent harnesses on the current machine + project — Claude Code
  user scope (`~/.claude/`), Claude Code project scope (`.claude/`
  in cwd), Cursor's `.cursorrules`, Cursor's `.cursor/rules/` dir,
  and aider (via `CONVENTIONS.md` or `.aider.conf.yml`) — and
  installs `SKILL.md` to each.
- **Interactive by default**, with `--yes` / `-y` for CI / scripts,
  `--target=<id>` for a specific harness, and `--force` to overwrite
  existing files (also bypasses the detection requirement when
  combined with `--target`).
- **Idempotent appends.** Writes to `.cursorrules` and
  `CONVENTIONS.md` go between marker comments
  (`<!-- vibeguard-skill-begin -->` / `<!-- vibeguard-skill-end -->`);
  re-running the install replaces between markers rather than
  appending a second copy. Same for the optional `CLAUDE.md` memory
  line (uses its own marker pair).
- **Optional `--with-memory=user|project` flag** (or an interactive
  prompt after install) appends a one-line activation directive to
  `CLAUDE.md` at the chosen scope. This is the most reliable way to
  force the skill to fire on every SQL-related prompt — Claude's
  description-based routing is best-effort; `CLAUDE.md` is a hard
  directive. **Opt-in only** — the subcommand does not touch
  `CLAUDE.md` without explicit consent (via the flag, the prompt
  choice, or `--with-memory=` non-interactively).
- **Frontmatter is stripped automatically** when writing to
  harnesses (Cursor's `.cursorrules`, aider's `CONVENTIONS.md`) that
  don't parse YAML frontmatter — they would otherwise render the
  `---` fences as literal horizontal rules. The full file (with
  frontmatter intact) is written to Claude Code's `SKILL.md` and
  Cursor's `.cursor/rules/*.mdc` paths.
- **README install recipes rewritten.** Both root and package
  README now lead with `npx vg-local install-skill` and document
  the manual `cp` paths as a fallback (now genuinely working
  because of the `files` field fix above).
- **Drift prevention.** The SKILL.md content embedded in the
  install-skill subcommand is generated at build time from the
  canonical `examples/agent-skill/SKILL.md` via a `prebuild` /
  `pretest` / `pretypecheck` script. A unit test asserts the inline
  string matches the source file byte-for-byte, so silent drift is
  impossible.

## [1.7.0] - 2026-05-11

**Agent-native output surface.** No new catches, no detection changes.
This release adds the output formats, drop-in skill file, stdin pipe,
and experimental reflection mode that turn `@vibeguard-dev/local`
from a CLI tool into something agent harnesses can ingest
programmatically. All 36 catches behave identically to 1.6.0; the
new surface is purely additive.

### Added

- `--format=jsonl` / `--format=ndjson` flag on `vg-local analyze` for
  machine-readable output. One JSON object per catch on stdout. The
  two flag values are aliases (same emitter, same bytes). Stable
  per-line schema with `_schema: "vg-jsonl/1"` versioning tag;
  documented in [STABILITY.md](./STABILITY.md#jsonl-output-schema).
- `STABILITY.md` gains a "JSONL output schema" section committing to
  semver rules for the per-line shape (field removal/rename = major,
  addition = minor, semantic change = major).
- Default output (no `--format` flag, or `--format=human`) is
  unchanged. Parse errors and skip warnings stay on stderr in all
  formats.
- `examples/agent-skill/` — drop-in `SKILL.md` plus companion README
  for Anthropic Skills-compatible harnesses (Claude Code today;
  portable to Cursor / aider per the README's adaptation notes).
  Frontmatter uses only `name` + `description` — fields actually
  shipping in Claude Code today; no aspirational interop is claimed.
  Pairs with the new `--format=jsonl` mode above for the agent's
  pre-flight loop.
- `--stdin` flag on `vg-local analyze` — reads SQL from process stdin
  instead of expanding a file-glob, so agents and shell pipelines can
  pre-flight in-memory SQL without writing to a temp file:
  `echo "$SQL" | vg-local analyze --stdin --format=jsonl`. The "file"
  field in structured output is `<stdin>`. Mutually exclusive with
  positional globs, `--fix`, and `--fix-dry-run` (no on-disk file to
  write back to). `SKILL.md` updated to recommend the pipe pattern
  over the previous `mktemp` workaround.

### Added (experimental)

- `--reflect` / `--format=reflect` flag on `vg-local analyze` — emits
  one *reflection* JSON object per catch on stdout, designed for
  agent episodic-memory / lessons-learned ingestion. Each line
  includes `pain_score` (0–10), `importance` (0–10), a templated
  `reflection` paragraph, and a one-line `suggested_lesson` keyed on
  the catch's stable `code`. **The schema is `vg-reflect/0` and is
  explicitly NOT under semver commitments yet** — see
  [STABILITY.md → Reflection output schema (EXPERIMENTAL)](./STABILITY.md#reflection-output-schema-experimental)
  for the graduation criteria (≥1 external consumer + 30-day field
  stability hold → promote to `vg-reflect/1` with full semver).
- `docs/reflect-mode.md` — one-page walkthrough with consumption
  recipes (`vg-local analyze --reflect | jq -r '.suggested_lesson' >> LESSONS.md`).
- `--reflect` is mutually exclusive with `--format=human|jsonl|ndjson`
  — combining them is a usage error (exit 2), matching the existing
  `--fix` / `--fix-dry-run` mutual-exclusivity precedent.

## [1.6.0] - 2026-05-09

**Postgres catalog expansion.** 21 new catches (`SQL-016` through
`SQL-036`) focused on destruction, exfiltration, privilege escalation,
and the analyzer blind spots that prior versions left open. The
catch count jumps from **15 to 36** — roughly tripling the local
SDK's coverage of agent-issued SQL footguns.

### Added

The new catches cluster into five themes. All are default-ON unless
noted; all are shipped at v1.6.0 stable.

**RCE / supply chain (block):**

- **`SQL-016` — `COPY … FROM/TO PROGRAM`** (block / 99). Postgres'
  documented superuser-only RCE primitive: the `filename` is a shell
  command run on the database host under the postgres OS-user.
- **`SQL-017` — `CREATE EXTENSION` of an untrusted procedural language**
  (block / 95). `plpythonu`, `plperlu`, `pllua`, `plsh` and friends —
  any extension that gives the database server arbitrary code execution
  outside the SQL sandbox.

**Schema / DDL hazards (warn / info):**

- **`SQL-018` — `ALTER TABLE … DROP COLUMN`** (warn / 90). Column data
  is gone the moment the statement commits; no `WHERE` softens it.
- **`SQL-019` — `CREATE TRIGGER`** (info / 75). Hides side effects on
  every matching row of subsequent DML — invisible to anyone reading
  only the surface SQL.
- **`SQL-020` — `CREATE OR REPLACE FUNCTION`** (info / 70). Silently
  overwrites whatever existed at that name in that schema.

**Privilege escalation (block / warn):**

- **`SQL-021` — `GRANT … TO PUBLIC`** (warn / 90). Privileges every
  current and future role on the cluster, including roles that didn't
  exist when the GRANT was issued.
- **`SQL-022` — `CREATE/ALTER ROLE … SUPERUSER`** (block / 95). A
  superuser bypasses every permission check including row-level
  security and the foreign-data-wrapper sandbox.

**Operational hazards (warn):**

- **`SQL-023` — `pg_terminate_backend` / `pg_cancel_backend`** (warn /
  85). Bulk-applied against `pg_stat_activity` it is a one-shot DoS
  primitive.
- **`SQL-024` — `VACUUM FULL`** (warn / 80). Takes ACCESS EXCLUSIVE on
  the rewritten table — a documented production outage primitive.
- **`SQL-025` — `REFRESH MATERIALIZED VIEW`** without `CONCURRENTLY`
  (warn / 75). Blocks all reads for the duration of the rebuild.

**Detection blind spots and exfiltration channels:**

- **`SQL-026` — `MERGE` with tautological `ON`** (block / 90). The
  MERGE-side mirror of SQL-034 — full-table mutation expressed in
  syntax SQL-001/003 do not catch.
- **`SQL-027` — `SET search_path`** to a non-system schema (warn / 85).
  Reroutes unqualified table/function references to attacker-controlled
  shadow definitions.
- **`SQL-028` — `pg_create_*_replication_slot`** (warn / 80). Streams
  every WAL change to whoever connects; orphaned slots also pin WAL
  retention indefinitely (DoS by disk).
- **`SQL-029` — `dblink` / `CREATE SERVER`** (warn / 80). Outbound
  network from the database server — the canonical "query data here,
  send it there" exfiltration shape.
- **`SQL-030` — `lo_export` / `pg_read_server_files` / `pg_ls_dir`**
  (warn / 90). Server-side filesystem access under postgres OS-user.

**Boundary cases (info):**

- **`SQL-031` — `INSERT … SELECT … ON CONFLICT DO UPDATE`** without
  LIMIT (info / 75). Full-table overwrite expressed through INSERT
  syntax — bypasses SQL-001's UPDATE/DELETE blanket detection.
- **`SQL-032` — `EXPLAIN ANALYZE` of a destructive statement** (info /
  80). EXPLAIN ANALYZE actually executes the inner statement to
  measure timing — the ANALYZE keyword is a silent destructiveness
  modifier that many operators miss.
- **`SQL-033` — `DO $$ … $$`** anonymous procedural block (info / 70).
  An opaque body the analyzer cannot inspect — surface a reminder that
  unparsed code is being executed.

**Semantic full-table mutations (block):**

- **`SQL-034` — `WHERE <tautology>` on UPDATE/DELETE** (block / 95).
  Catches `WHERE 1=1`, `WHERE true`, `WHERE id = id`, `WHERE NOT
  false`, `WHERE 'a' = 'a'`. Closes the SQL-003 placeholder-WHERE
  blind spot. Deliberately does NOT recurse into AND/OR — `WHERE 1=1
  AND id = 42` does NOT fire (that's a real query).
- **`SQL-035` — `UPDATE … FROM` without join predicate** (block / 90).
  Cartesian product on the source side; every target row updated with
  values from an arbitrary source row, silently and at plausible row
  counts.
- **`SQL-036` — `DELETE … USING` without join predicate** (block / 90).
  USING-side mirror of SQL-035.

### Performance

A naïve port of all 21 rules regressed every fixture by 100–270%
(every rule called `astWalk` over the full AST independently — 36
walks per `analyze()` instead of 15). Two optimizations bring the
marginal cost to **+4.7% aggregate** vs. the V1.5 registry on the
same machine, well under the 20% per-fixture / 100µs absolute-delta
gate:

- **`hasTopLevelStmt(ast, kinds)`** — O(N_stmts) top-level statement-
  kind dispatch (typically O(1)). Each new rule short-circuits to
  `null` before walking when the relevant top-level statement kind
  isn't present. Lives in `packages/sdk/src/rules/stmt-dispatch.ts`.
- **`extractFuncNames(ast)`** — WeakMap-memoized per-AST extractor of
  every `FuncCall` last-segment name. Rules SQL-023, SQL-028, SQL-029,
  SQL-030 all share a single walk via this helper — going from 4
  per-rule walks to 1 shared walk per `analyze()` call. Lives in
  `packages/sdk/src/rules/func-names.ts`. The walk is unconditional
  (no top-level statement gate) because these functions can appear
  inside `INSERT … SELECT`, `UPDATE … SET col = …`, `EXPLAIN SELECT`,
  and other non-`SelectStmt` contexts — gating on top-level
  `SelectStmt` would create exfiltration false-negatives.

The bench baseline at `benchmarks/baseline.json` was refreshed on
Linux for this release. The previous baseline was captured on win32
(May 2026) and was no longer comparable.

### Changed

- **`RULES.length` is now 35, was 14.** SQL-016 through SQL-036 are
  default-on except none — all 21 new rules are default-on. SQL-014
  remains the single default-off rule. Per STABILITY.md this is a
  minor-version event.
- **Test count: 538 → 731.** +193 across 21 new rule test files
  (positive, negative, and multi-statement composition coverage) and
  +11 SQL-008 tests covering the new two-tier behavior (CASE 1
  runtime-injection, CASE 2 pure-literal payload-shape, CASE 3
  benign-literal silent, plus the 5 reported battery queries pinned
  verbatim and the verbatim gallery sample).
- README catch table updated from 15 to 36 rows. The "Known
  limitations" section in `packages/sdk/README.md` was rewritten to
  reflect that literal tautologies are now caught by SQL-034.
- **SQL-008 expanded to also detect literal-only concatenation
  containing injection-payload signatures (CASE 2, info/75). Existing
  CASE 1 behavior unchanged. Purely additive.** The new CASE 2 fires
  on `||` chains where every operand is a literal A_Const AND at
  least one literal matches the injection-payload signature regex
  (`OR`/`UNION`/`DROP`/`TRUNCATE`/`DELETE`/`EXEC`/`EXECUTE`, comment
  markers, statement terminators, `1=1` tautology, `''=''` quote
  evasion). Catches the LLM-authored injection-shape footprint
  (e.g. `'admin' || ' OR 1=1'`) that's constant-folded at runtime
  but is the unmistakable signature of injection-style code
  authoring. CASE 1 (any non-literal operand) remains at `block`/90
  for param refs and `block`/80 for function-call/other mixes —
  byte-identical to v1.5. New `RuleEntry.confidenceRange` field
  declares SQL-008's `[75, 90]` span. Full trace in
  `docs/rules/sql-008.md` and `tests/test-sql-008-string-concat.test.ts`.
- **`RuleEntry` gains optional `confidenceRange: readonly [number, number]`.**
  Documentation aid for rules that emit at multiple confidence tiers.
  Additive — existing entries continue to work unchanged.

### Migration notes

V1.5 → V1.6 is fully backwards compatible. No public types changed;
no exports were removed or renamed. The new rules surface through
the same `analyze()` and `RULE_REGISTRY` paths as before.

Customers running the public default path (`analyze(sql)`) will start
seeing SQL-016 through SQL-036 catches on queries that previously
returned empty `catches` arrays — that is the intended behavior. To
suppress any individual rule for a single call, use `options.rules`:

```ts
analyze(sql, { rules: { 'sql-019': { enabled: false } } });
```

## [1.5.0] - 2026-05-08

Browser support arrives via a new subpath import. The web playground
shipping at the same time (`apps/playground` in the workspace) needs
to run the rule registry against an AST without pulling in the
SDK's Node-only parser bootstrap.

### Added

- **`@vibeguard-dev/local/rules` subpath export.** A browser-safe
  subset of the public API:
  - `runRules`, `RunRulesOptions`
  - `RULES`, `RULE_REGISTRY`, `RuleEntry`
  - All public types (`Catch`, `AnalysisResult`, `Severity`,
    `ThreatCategory`, `Rule`, `Fixer`, `ParseError`)

  Browser consumers feed an externally-parsed AST (e.g. from
  `libpg-query`'s ESM build) directly to `runRules` and skip the
  SDK's parser. Same 15 catches; no fork of analysis logic.

  The default `@vibeguard-dev/local` import keeps its existing
  surface, including `init` / `analyze` / `parseQuery` / `applyFixes`
  — those still go through `parser.ts` and remain Node-only.

- **Sibling package**:
  [`@vibeguard-dev/ui@0.1.0`](https://www.npmjs.com/package/@vibeguard-dev/ui)
  — shared design system (tokens + React components) consumed by
  the V1.5 playground.

### Migration notes

V1.4 → V1.5 is fully backwards compatible. No existing import path
changes; no symbols are removed or renamed. The `/rules` subpath is
purely additive.

## [1.4.0] - 2026-05-08

Sibling-package release. The SDK itself ships **no surface changes**
in this version — `analyze()`, `applyFixes()`, `RULE_REGISTRY`, the
public types, and the `vg-local` CLI are all byte-identical to V1.3.
The version bump exists to keep the SDK in lockstep with the new
sibling package shipping at the same time:

- **[`eslint-plugin-vibeguard@1.0.0`](https://www.npmjs.com/package/eslint-plugin-vibeguard)** —
  ESLint 9+ plugin that runs the SDK's 15-catch analyzer on tagged
  template literals (`` sql`...` ``) and configurable call
  expressions (`db.query(...)`). Reuses the V1.3 `applyFixes()`
  runner verbatim, so the four rules with fixers (SQL-001, SQL-005,
  SQL-006, SQL-011) are autofixable in-editor through `--fix`.

The plugin lives at `packages/eslint-plugin/` in the workspace and
declares `@vibeguard-dev/local` as a dependency.

### Migration notes

V1.3 → V1.4 is a no-op for SDK consumers. Upgrade only if you also
plan to install the new ESLint plugin and want the same SDK version
your plugin was tested against.

## [1.3.0] - 2026-05-07

The "ESLint moment" — `--fix` autofix support arrives. Four rules
get fixers; the analyzer pipeline gains an iterate-until-stable
runner; the CLI gets `--fix` and `--fix-dry-run` flags.

### Added

- **Autofix mode (`--fix`).** `vg-local analyze 'src/**/*.sql' --fix`
  applies fixes in place, writing changed files back to disk. Exit
  code is 1 if any block-severity catch remains after fixing.
- **Dry-run mode (`--fix-dry-run`).** Prints a unified diff per
  changed file; does not write. Useful for CI / review workflows.
  Mutually exclusive with `--fix` (passing both is a usage error,
  exit 2).
- **`Fixer` public type.** Optional companion to a `Rule`. Single-
  fix-per-call contract: each fixer applies at most one occurrence
  of its catch's pattern; the runner iterates.
- **`RuleEntry.fixer`** — optional field on the rule registry. Four
  rules get fixers in V1.3:
  - **SQL-001** — placeholder fix. `FROM a, b` → `FROM a JOIN b ON
    TRUE /* TODO(vibeguard SQL-001): replace TRUE with a real
    predicate */`. Semantics unchanged (still cartesian); the fix
    converts the implicit cross-product into an explicit, marked
    one for the agent retry loop or human reviewer to address.
  - **SQL-005** — `col = NULL` → `col IS NULL`; `col <>/!= NULL`
    → `col IS NOT NULL`. Source-text manipulation guided by the
    AST, with string-literal masking so `'= NULL'` inside a quoted
    string is preserved.
  - **SQL-006** — placeholder fix. Inserts `ORDER BY 1` before the
    first `LIMIT` / `OFFSET`. `1` is a placeholder column ordinal;
    replace with the real column for stable pagination.
  - **SQL-011** — adds `GROUP BY <missing column>` named after the
    first naked (non-aggregated) column. Inserted before any
    HAVING / ORDER BY / LIMIT / OFFSET; appended to end-of-statement
    otherwise. Preserves qualified column names (`t.name`).
- **`applyFixes(sql, options?)`** — public runner. Iterate-until-
  stable: applies fixes, re-parses, re-runs rules, repeats. Hard
  cap at `maxIterations` (default 10) prevents runaway loops.
  Per-fix parse-verify rolls back any fix that produces unparseable
  SQL. Returns `{ sql, changed, fixesApplied, remainingCatches,
  hitIterationLimit, fixersInvoked }`.
- **`ApplyFixesOptions`** — shape parallels `AnalyzeOptions`. Same
  `rules` overrides (case-insensitive) so disabled rules' fixers
  don't run.
- Per-rule docs pages now carry an `Auto-fix` row in their metadata
  table for SQL-001, SQL-005, SQL-006, SQL-011.
- README catch table gains an `Auto-fix` column.

### Changed

- **Test count: 452 → 509.** +26 fixer detection / no-op / parse-
  cleanly tests, +21 applyFixes runner tests (compound, opt-in/out,
  iteration cap, telemetry), +10 CLI flag tests (--fix writes,
  --fix-dry-run prints, conflict).
- `dist/index.js` and `dist/index.cjs` grew slightly to fit the
  fixer code paths and the runner. Still well within the 30 KB ESM
  / 100 KB CJS size budget.

### Architecture notes

- Fixers do **source-text manipulation**, not AST→SQL deparse.
  Deparse loses comments, whitespace, quoting style — all of which
  matter to a developer reading their own code. Fixers use the AST
  to find _whether_ a fix applies; the actual edit is applied to
  the source string, with string-literal masking to avoid editing
  text inside quoted strings.
- The runner's safety story: every applied fix is re-parsed
  immediately. If the parse fails, the fix is rejected and the
  previous SQL state is preserved. The "current" SQL never advances
  to a state that doesn't parse.
- A throwing fixer doesn't crash the run — try/catch around each
  fixer invocation skips the rule and tries the next.

### Migration notes

V1.2 → V1.3 is fully backwards compatible. The new `Fixer` type and
`applyFixes` function are additive. Existing consumers using
`analyze()` see identical output to V1.2; only opt-in to autofix
via the CLI flags or by calling `applyFixes()` directly.

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
