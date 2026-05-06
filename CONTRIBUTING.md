# Contributing to @vibeguard-dev/local

Thanks for your interest. This guide explains what fits the SDK's scope,
how to propose a new catch, and what we ask of submitted code.

## What fits the SDK's scope

A catch belongs in this SDK if **all four** of these are true:

1. **Detectable from AST alone.** The pattern can be identified by
   walking the parse tree of a single SQL statement. If detection
   needs runtime context (row counts, schema introspection, prior
   queries in the session, behavioral baselines), it doesn't fit
   here — that's VibeGuard Cloud territory.
2. **Documented real-world incidents.** Public blog post, post-mortem,
   bug report, CVE, or similar. We don't ship hypothetical catches.
3. **Postgres-dialect-applicable.** The SDK targets the Postgres SQL
   dialect via `libpg-query`. Patterns specific to MySQL / SQL Server /
   Oracle / SQLite go in their own sibling SDKs eventually, not here.
4. **Stable enough for a forever-ID.** Catch IDs are stable across all
   future versions (see [STABILITY.md](./STABILITY.md)). If the pattern
   is likely to be redefined or renamed in six months, it's not ready.

If your idea doesn't fit, that's fine — open an issue anyway and we'll
discuss whether it belongs in a sibling project, the cloud product, or
neither.

## Proposing a new catch

**Step 1 — open an issue.** Use the
[New catch proposal](./.github/ISSUE_TEMPLATE/new_catch.yml) template.
Required fields:

- A real-world incident link
- Example SQL that **should** fire the catch
- Example SQL that should **not** fire (the false-positive guard)
- A sketch of the AST detection logic at the node-shape level
- Proposed severity (`block` / `warn` / `info`)

Don't write code yet. Wait for maintainer feedback on whether the
proposal fits the scope.

**Step 2 — implement.** Once a maintainer agrees the catch fits, you
write the rule. The structure is:

- One source file per catch under `src/rules/sql-NNN-<slug>.ts`
- The file exports a `SQL_NNN: Rule` function that takes parsed AST
  and returns `Catch | null`
- The rule consumes substrate helpers (`astWalk`, `extractFromTables`,
  `extractColumns`) — does not reimplement them
- Catalog entries (specific keywords / function names / etc.) stay
  inline in the rule file unless they're shared across rules

**Step 3 — test.** Each catch ships with **at least 10 unit tests**
covering:

- Several positive cases (the rule SHOULD fire)
- Negative cases (false-positive guards — patterns that look similar
  but shouldn't fire)
- Edge cases: empty input, whitespace variants, qualified names,
  WITH-clause / CTE shapes, multi-statement scripts where applicable

The existing test suites under `tests/` are the bar. New catches
mirror that style and density.

**Step 4 — document.** One markdown page under `docs/rules/sql-NNN.md`
covering:

- The pattern in plain English
- Why it's dangerous (incident references)
- A bug example
- A correct alternative
- The detection approach (AST node shape, at a high level)

**Step 5 — open the PR.** Use the
[pull request template](./.github/pull_request_template.md). The PR
description references the original issue and lists the new files.

## What we ask

- Code matches the existing style (TypeScript strict mode, no `any`
  in production code, descriptive names, comments where the AST
  shape is non-obvious)
- Tests pass locally (`npm test`) and in CI
- Documentation page is in place
- No new runtime dependencies (peer-dependency `libpg-query` is the
  only allowed runtime dep)
- Bundle size doesn't regress (CI enforces a per-package size budget)

## What we promise

- A maintainer responds to issues within ~5 business days, ~3 for
  PRs that are scoped to a previously-agreed proposal
- Public credit in the catch's docs page (unless you prefer otherwise)
- Honest feedback: if your PR doesn't fit, we tell you why and link to
  related projects that might be a better home

## Things that are NOT contributions to this SDK

The following don't belong here. Either they're cloud-product features
or they're scope-creep that would dilute the SDK's static-analysis
positioning:

- Intent-vs-SQL comparison logic (cloud only)
- Any LLM-driven evaluation (cloud only)
- Audit-log / hash-chain features
- HITL workflow integrations
- Encryption / key-management features
- Multi-tenant isolation
- Cloud-product API client code (will live in a separate
  `@vibeguard-dev/cloud-client` package)

If your idea points in any of those directions, let's talk in an
issue first — it might be a great cloud-product feature, just not
SDK code.

## Questions

For non-bug, non-catch-proposal questions, use the
[Question issue template](./.github/ISSUE_TEMPLATE/question.yml).
