# SDK Roadmap

This roadmap is for the SDK only. The broader VibeGuard cloud product
roadmap lives separately.

`@vibeguard-dev/local` is at `1.0.0` — feature-complete and stable.
The SDK is in slow, deliberate maintenance mode. New catches go
through the proposal process in [CONTRIBUTING.md](./CONTRIBUTING.md).
Major versions ship at most once a quarter. No surprise breaking
changes.

## What's IN scope for the SDK

- Static AST-detectable SQL anti-patterns
- Postgres dialect (via libpg-query)
- Server-side Node usage
- Pure-function rules with no runtime state

## What's NOT in scope (deliberately)

These belong elsewhere:

- **Intent-vs-SQL comparison** — needs an LLM. Cloud product.
- **Real EXPLAIN-driven blast radius** — needs a Postgres connection.
  Cloud product.
- **Tamper-evident audit logging** — needs a backing store. Cloud product.
- **HITL escalation** — needs workflow infrastructure. Cloud product.
- **Per-agent behavioral baselines** — needs persistent state across
  many calls. Cloud product.
- **Other dialects** (MySQL, SQL Server, Oracle, SQLite) — sibling SDK
  projects when there's pull, not in this repo.
- **Browser usage** — initial release is server-side Node only. May
  revisit if there's real demand.
- **CLI / VS Code extension / editor plugins** — possible 2.x territory
  if there's pull.

## Pull requests welcome for...

- New catches that meet the scope criteria in
  [CONTRIBUTING.md](./CONTRIBUTING.md)
- Better false-positive guards on existing catches
- Performance improvements that don't change rule semantics
- Documentation polish, more example integrations
- Translation of docs / error messages (if there's contributor pull)

## Pull requests politely declined for...

- Catches that need runtime context to detect
- Sweeping refactors that don't address a specific bug or scope gap
- Adding new dependencies (one peer dep is the budget)
- Telemetry, version-check pings, or any outbound traffic
- Branding changes — keep the README's voice

## How decisions get made

For now, maintainer call. As the project grows we'll formalize a
governance model (likely BDFL → SC structure as adoption justifies it).
Until then: open an issue, talk it through, ship code if we agree.
