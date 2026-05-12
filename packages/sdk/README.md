# @vibeguard-dev/local

> **Static SQL safety analysis for AI agents.**
> Catch the dangerous queries before they reach your database.

[![npm version](https://img.shields.io/npm/v/@vibeguard-dev/local)](https://www.npmjs.com/package/@vibeguard-dev/local)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![CI](https://github.com/MuddySheep/vibeguard-local/actions/workflows/ci.yml/badge.svg)](https://github.com/MuddySheep/vibeguard-local/actions)

---

## What it does

Your AI agent generates a SQL query. Before you run it, `@vibeguard-dev/local`
checks the query's structure for known footguns: missing `WHERE` clauses,
cartesian explosions, type-coercion bugs, recursive CTEs that don't
terminate, irreversible `DROP` / `TRUNCATE`, over-fetching projections.
**36 senior-DBA-level checks**, all static, sub-millisecond, zero network
calls.

## Known limitations

VibeGuard is a **static, schema-blind** analyzer. It checks the *shape*
of a query, not its run-time effect. A few boundaries you should know
about before you ship it into CI:

- **Literal tautologies in `WHERE` are caught (since v1.6.0).** SQL-034
  fires at `block` / 95 on `UPDATE` / `DELETE` whose `WHERE` reduces to
  a literal tautology — `WHERE 1=1`, `WHERE true`, `WHERE id = id`,
  `WHERE NOT false`, `WHERE 'a' = 'a'`. The cross-join variants
  (`UPDATE … FROM` / `DELETE … USING` without a join predicate) are
  caught by SQL-035 and SQL-036 at `block` / 90.

  What is still NOT caught: **semantic tautologies that depend on
  schema knowledge**, such as `DELETE FROM users WHERE id IS NOT NULL`
  on a `NOT NULL` PK column, or `DELETE FROM users WHERE id IN (SELECT
  id FROM users)`. These require column-nullability or correlated-
  reference tracking and are out of scope for the local SDK.

- **Schema-aware checks are out of scope.** The SDK does not know
  which columns are `NOT NULL`, which columns are foreign-key targets,
  or which tables hold sensitive data. Rules that would require that
  context (e.g. "this `WHERE col IS NOT NULL` is a no-op because
  `col` is the `NOT NULL` PK") are deliberately not in `local`.

- **Run-time effects are not modeled.** The analyzer does not execute
  the query, plan it, or evaluate constants. `WHERE 1=1` and `WHERE
  current_timestamp > '1970-01-01'` are static-tautological in the same
  way; the SDK treats both as "has a `WHERE` clause".

The trade-off is intentional: every check runs offline, sub-millisecond,
with zero network calls and zero schema dependencies. If you need
schema-aware analysis, that's the cloud product.

## Quickstart

```bash
npm install @vibeguard-dev/local libpg-query
```

`libpg-query` is a peer dependency — install it alongside the SDK.
Server-side Node only for the initial release; browser support is
out of scope for now.

### One-shot CLI

The fastest way to see what the SDK does:

```bash
npx @vibeguard-dev/local init
```

That scaffolds an example SQL file, runs the analyzer on it, prints
the catch with severity and fix, and adds an `npm run lint:sql`
script to your `package.json` you can wire into CI. For ongoing use:

```bash
vg-local analyze 'src/**/*.sql'
# Exits 0 if no block-severity catches; 1 if any. CI-friendly.

vg-local analyze 'src/**/*.sql' --fix-dry-run
# Print a unified diff of what --fix would change. Read-only.

vg-local analyze 'src/**/*.sql' --fix
# Apply autofixes in place. SQL-005 / SQL-006 / SQL-001 / SQL-011
# have fixers; other rules surface their catches unchanged.
```

### Agent skill install (`vg-local install-skill`)

One command auto-detects agent harnesses (Claude Code, Cursor, aider)
on the current machine and project, and installs the
`vibeguard-sql-safety` skill into each:

```bash
npx vg-local install-skill          # interactive
npx vg-local install-skill --yes    # non-interactive (CI / scripts)
```

For deterministic activation in Claude Code, opt in to a `CLAUDE.md`
memory directive (the most reliable activation lever — Claude's
description-based skill routing is best-effort):

```bash
npx vg-local install-skill --yes --with-memory=user
# or --with-memory=project for project-scoped activation
```

Restrict to one specific harness: `--target=claude-user` (or
`claude-project`, `cursor-rules-file`, `cursor-rules-dir`, `aider`).
Idempotent — re-running replaces content between marker comments,
never duplicates. See `vg-local install-skill --help` for the full
option list.

The `SKILL.md` file also ships in the npm tarball at
`node_modules/@vibeguard-dev/local/examples/agent-skill/SKILL.md` for
users who prefer to copy it manually.

### Machine-readable output (`--format=jsonl`)

For agent harnesses, CI pipelines, and `jq` users, `analyze` has a
stable JSONL output mode:

```bash
vg-local analyze 'src/**/*.sql' --format=jsonl
# One JSON object per catch on stdout. Parse errors stay on stderr.

vg-local analyze 'src/**/*.sql' --format=jsonl \
  | jq -c 'select(.severity == "block")'
# Filter to blocking catches only.
```

`--format=ndjson` is accepted as an alias and emits the same bytes.
The per-line schema is stable post-1.7.0 and documented in
[STABILITY.md](./STABILITY.md#jsonl-output-schema).

#### Pipe from stdin (`--stdin`)

For agents and shell pipelines that have SQL in-memory and don't want
to write a temp file:

```bash
echo "$SQL" | vg-local analyze --stdin --format=jsonl
# Reads SQL from stdin. The "file" field in JSONL output is "<stdin>".
```

`--stdin` is mutually exclusive with positional globs, `--fix`, and
`--fix-dry-run` (no on-disk file to write back to). The future
`--stdin --fix` "stream-rewrite" mode is deliberately out of scope
for v1.7.

#### Reflect mode (experimental)

`vg-local analyze --reflect` (or `--format=reflect`) emits one
*reflection* JSON object per catch — designed for agent
episodic-memory ingestion. Each line includes `pain_score`,
`importance`, `reflection`, and `suggested_lesson` alongside the
standard catch metadata. The schema is `vg-reflect/0` and is
**explicitly NOT under semver commitments yet** — see
[STABILITY.md → Reflection output schema (EXPERIMENTAL)](./STABILITY.md#reflection-output-schema-experimental)
for the graduation criteria, and [docs/reflect-mode.md](./docs/reflect-mode.md)
for consumption recipes.

```bash
vg-local analyze 'src/**/*.sql' --reflect \
  | jq -r '"- \(.suggested_lesson)"' >> LESSONS.md
```

### ESM

```ts
import { analyze, init } from "@vibeguard-dev/local";

await init(); // one-time WASM-parser bootstrap

const result = analyze(`UPDATE users SET email = 'x@y.com'`);

if (result.catches.length > 0) {
  console.error(result.catches[0]);
  // {
  //   code: 'SQL-003',
  //   title: 'Unbounded UPDATE statement',
  //   severity: 'block',
  //   confidence: 99,
  //   detail: 'UPDATE on `users` has no WHERE clause. Every row in the table will be modified...',
  //   fix:    'Add a WHERE clause that scopes the update to specific rows...',
  //   threatCategories: ['destruction'],
  // }
}
```

### CommonJS

```js
const { analyze, init } = require("@vibeguard-dev/local");

(async () => {
  await init();
  const result = analyze("DELETE FROM users");
  console.log(result.catches[0]?.code); // 'SQL-003'
})();
```

That's the whole API. After `init()`, every `analyze()` call is
synchronous and sub-millisecond on typical queries.

## What we deliberately do NOT do

This SDK does **static analysis only**. It checks the *shape* of your SQL.
It does **not**:

- Compare your agent's stated intent against what the SQL would actually do
- Estimate real blast radius from the upstream Postgres planner
- Provide tamper-evident audit logging
- Offer human-in-the-loop escalation for grey-zone queries
- Track per-agent behavioral baselines over time

For those, you want **VibeGuard Cloud** — the wire-protocol proxy and MCP
server this SDK is the static-analysis layer of. Use the SDK locally; use
the cloud in production. The two are designed to work together.

## The 36 catches

Each catch has a stable code (e.g. `SQL-001`), a severity, a confidence
range, and links to a docs page with examples and references. **Catch IDs
are forever-stable** — once published, an ID always means the same thing
(see [STABILITY.md](./STABILITY.md)).

| Code | Title | Severity | Confidence | Default | Auto-fix | Status |
|---|---|---|---|---|---|---|
| [`SQL-001`](./docs/rules/sql-001.md) | Cartesian explosion | block | 90–95 | ON | placeholder | ✅ shipped |
| [`SQL-002`](./docs/rules/sql-002.md) | Self-join footgun | warn | 70–85 | ON | — | ✅ shipped |
| [`SQL-003`](./docs/rules/sql-003.md) | Unbounded UPDATE / DELETE | block | 95–99 | ON | — | ✅ shipped |
| [`SQL-004`](./docs/rules/sql-004.md) | Implicit type coercion in WHERE | warn | 75–85 | ON | — | ✅ shipped |
| [`SQL-005`](./docs/rules/sql-005.md) | NULL comparison footgun | warn | 90–95 | ON | yes | ✅ shipped |
| [`SQL-006`](./docs/rules/sql-006.md) | OFFSET without ORDER BY | warn | 85–95 | ON | placeholder | ✅ shipped |
| [`SQL-007`](./docs/rules/sql-007.md) | NOT IN with nullable subquery | warn | 75–85 | ON | — | ✅ shipped |
| [`SQL-008`](./docs/rules/sql-008.md) | String-concat injection patterns | block | 80–95 | ON | — | ✅ shipped |
| [`SQL-009`](./docs/rules/sql-009.md) | DISTINCT without obvious reduction | info | 60–75 | ON | — | ✅ shipped |
| [`SQL-010`](./docs/rules/sql-010.md) | Correlated subquery in SELECT | warn | 70–85 | ON | — | ✅ shipped |
| [`SQL-011`](./docs/rules/sql-011.md) | Aggregate without GROUP BY | warn | 85–95 | ON | yes | ✅ shipped |
| [`SQL-012`](./docs/rules/sql-012.md) | Recursive CTE without termination | block | 80–95 | ON | — | ✅ shipped |
| [`SQL-013`](./docs/rules/sql-013.md) | DROP / TRUNCATE / DDL destruction | block / warn | 85–99 | ON | — | ✅ shipped (1.1.0) |
| [`SQL-014`](./docs/rules/sql-014.md) | INSERT/UPDATE/DELETE without RETURNING | info | 50 | **OFF** (opt-in) | — | ✅ shipped (1.1.0) |
| [`SQL-015`](./docs/rules/sql-015.md) | `SELECT *` over-fetch | info | 60 | ON | — | ✅ shipped (1.1.0) |
| [`SQL-016`](./docs/rules/sql-016.md) | `COPY … FROM/TO PROGRAM` (server-side RCE) | block | 99 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-017`](./docs/rules/sql-017.md) | `CREATE EXTENSION` of untrusted procedural language | block | 95 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-018`](./docs/rules/sql-018.md) | `ALTER TABLE … DROP COLUMN` | warn | 90 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-019`](./docs/rules/sql-019.md) | `CREATE TRIGGER` (hidden side effects) | info | 75 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-020`](./docs/rules/sql-020.md) | `CREATE OR REPLACE FUNCTION` (silent overwrite) | info | 70 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-021`](./docs/rules/sql-021.md) | `GRANT … TO PUBLIC` | warn | 90 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-022`](./docs/rules/sql-022.md) | `CREATE/ALTER ROLE … SUPERUSER` | block | 95 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-023`](./docs/rules/sql-023.md) | `pg_terminate_backend` / `pg_cancel_backend` | warn | 85 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-024`](./docs/rules/sql-024.md) | `VACUUM FULL` (ACCESS EXCLUSIVE outage) | warn | 80 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-025`](./docs/rules/sql-025.md) | `REFRESH MATERIALIZED VIEW` (blocking refresh) | warn | 75 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-026`](./docs/rules/sql-026.md) | `MERGE` with tautological `ON` | block | 90 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-027`](./docs/rules/sql-027.md) | `SET search_path` to attacker-controlled schema | warn | 85 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-028`](./docs/rules/sql-028.md) | `pg_create_*_replication_slot` | warn | 80 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-029`](./docs/rules/sql-029.md) | `dblink` / `CREATE SERVER` (outbound network) | warn | 80 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-030`](./docs/rules/sql-030.md) | `pg_read_*` / `lo_export` / `pg_ls_dir` (server FS) | warn | 90 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-031`](./docs/rules/sql-031.md) | `INSERT … SELECT … ON CONFLICT DO UPDATE` (unbounded upsert) | info | 75 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-032`](./docs/rules/sql-032.md) | `EXPLAIN ANALYZE` of a destructive statement | info | 80 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-033`](./docs/rules/sql-033.md) | `DO $$ … $$` opaque procedural block | info | 70 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-034`](./docs/rules/sql-034.md) | `WHERE 1=1` / literal tautology on UPDATE/DELETE | block | 95 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-035`](./docs/rules/sql-035.md) | `UPDATE … FROM` without join predicate | block | 90 | ON | — | ✅ shipped (1.6.0) |
| [`SQL-036`](./docs/rules/sql-036.md) | `DELETE … USING` without join predicate | block | 90 | ON | — | ✅ shipped (1.6.0) |

See [ROADMAP.md](./ROADMAP.md) for what's in / out of scope.

### Per-rule overrides

Opt in to default-OFF rules, or disable default-ON rules for a single
call, via the `rules` option. The key is the rule's catch code
(case-insensitive):

```ts
// Opt in to SQL-014 (missing RETURNING)
const result = analyze(sql, {
  rules: { 'sql-014': { enabled: true } },
});

// Disable SQL-007 for one call
const result = analyze(sql, {
  rules: { 'sql-007': { enabled: false } },
});
```

## Use with...

Each example is a short, runnable integration showing how to wire the
SDK into a common AI tool's pre-execution flow:

- **Claude Code** — see [`examples/claude-code/`](./examples/claude-code/)
- **Cursor** — see [`examples/cursor/`](./examples/cursor/)
- **Replit Agent** — see [`examples/replit-agent/`](./examples/replit-agent/)
- **Agent skill (drop-in `SKILL.md`)** — see
  [`examples/agent-skill/`](./examples/agent-skill/). Single-file skill
  for Anthropic Skills-compatible harnesses (Claude Code today;
  portable to Cursor / aider per the README's adaptation notes). Pairs
  with `--format=jsonl` for machine-readable analyzer output.

For in-editor feedback on `` sql`...` `` template literals (with
`--fix` autofix), see the sibling package
[`eslint-plugin-vibeguard`](https://www.npmjs.com/package/eslint-plugin-vibeguard).

## Architecture, in one paragraph

The SDK parses your SQL with `libpg-query`, walks the resulting AST with
a small, pure-function traversal helper, and runs each query through a
registry of catch-functions. Each catch returns either `null` (didn't
fire) or a structured `Catch` with code, severity, confidence, detail,
and fix. No network calls. No state between calls. Sub-millisecond on
typical queries. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full
design rationale.

## Contributing

We welcome new catches that meet the SDK's scope: static-AST-detectable
SQL anti-patterns with documented real-world incidents. The proposal
process starts with an issue ([template here](./.github/ISSUE_TEMPLATE/new_catch.yml));
PRs come after maintainer feedback on whether the pattern fits.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full process,
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for community expectations,
and [ARCHITECTURE.md](./ARCHITECTURE.md) for how the codebase is laid out.

## Security

This SDK does static analysis. **It does not execute SQL.** It does not
open network connections. It does not log to disk.

If you find a vulnerability — a false-negative that lets a real-world
dangerous pattern through, a panic / crash on adversarial input, or a
supply-chain concern — see [SECURITY.md](./SECURITY.md) for the
disclosure process. Do not file security issues as public GitHub issues.

## License

[Apache License 2.0](./LICENSE) — see also [`NOTICE`](./NOTICE) for
attribution requirements that travel with derivative works.

## About

VibeGuard is a wire-protocol security layer for AI agents that write SQL.
This SDK is the open-source static-analysis component of the broader
product.
