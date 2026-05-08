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
**15 senior-DBA-level checks**, all static, sub-millisecond, zero network
calls.

## Known limitations

VibeGuard is a **static, schema-blind** analyzer. It checks the *shape*
of a query, not its run-time effect. A few boundaries you should know
about before you ship it into CI:

- **Tautological `WHERE` clauses are not detected.** SQL-003 verifies
  that an `UPDATE` / `DELETE` *has* a `WHERE` clause; it does not check
  whether the clause meaningfully filters. The following slip through
  today and behave the same as an unbounded statement at run time:

  ```sql
  DELETE FROM users WHERE 1=1;
  UPDATE users SET banned = true WHERE id = id;
  DELETE FROM users WHERE id IS NOT NULL;             -- on a NOT NULL PK
  DELETE FROM users WHERE id IN (SELECT id FROM users);
  ```

  This is the most common AI-agent placeholder pattern (Cursor and
  Claude Code both emit `WHERE 1=1` as "I'll fill this in later" and
  forget). A literal-tautology detector (`WHERE 1=1`, `WHERE true`,
  `WHERE col = col`, `WHERE NOT false`) is planned as **SQL-016** in
  v1.1.0. Until then: assume `WHERE 1=1` is a missing filter and treat
  it like `DELETE FROM users` with no `WHERE` at all.

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

## The 15 catches

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
