# Security policy

## What this SDK is

`@vibeguard-dev/local` does static analysis of SQL strings. It:

- **Does not execute SQL** — at no point does the SDK open a database
  connection or run any query
- **Does not open network connections** — no telemetry, no version
  checks, no outbound traffic
- **Does not log to disk** — the SDK is a pure function; output is
  returned to the caller, the caller decides what to do with it

This shapes which kinds of issues are security-relevant.

## Reporting a vulnerability

**Do not file security issues as public GitHub issues.**

Email: `<TODO: security email — set before public launch>`

If the vulnerability is being actively exploited or could expose
customer data downstream, use the subject line `CRITICAL — VibeGuard SDK`.

We aim to:

- Acknowledge within 48 hours
- Provide an initial assessment within 5 business days
- Coordinate a disclosure timeline with the reporter, typically
  90 days
- Credit the reporter publicly (or anonymously, your preference) in
  the CHANGELOG and the GitHub Security Advisory

## What's in scope

These are the issue classes we treat as security:

- **False negatives where a real-world dangerous pattern is missed.**
  If a published incident demonstrates a SQL pattern that should fire
  one of our 12 catches but doesn't, that's a security bug.
- **Crashes / panics on adversarial input.** The SDK should never throw
  an unhandled exception on any input. Pathologically deep ASTs,
  malformed queries, edge-case syntax — we should fail safe (return
  no catches + a parse error in the result), never throw.
- **Supply-chain concerns.** If a release of `@vibeguard-dev/local`
  has been tampered with on npm, or if a dependency we ship has a
  known vulnerability, that's a security concern.

## What's out of scope

These issues exist but are not security:

- **Performance regressions.** File a regular bug report.
- **API ergonomics complaints.** File a regular issue.
- **False positives.** The catch fires on a pattern that's genuinely
  safe — file a regular bug, we'll tighten the rule. Not security.
- **Issues in `libpg-query`** itself. Report to the
  [libpg-query maintainers](https://github.com/launchql/libpg-query-node).
- **Issues in the VibeGuard cloud product.** That's a separate
  codebase with a separate disclosure process.

## What we will NOT do

- We do not pay bug bounties for the SDK at this time. A formal bug
  bounty program may launch alongside the cloud product's; this SDK
  may join later.
- We do not negotiate disclosure timelines below 30 days. If a
  vulnerability is severe enough to need same-day disclosure, we
  publish same-day along with the fix; we don't ship workarounds
  meant to hide the issue.
- We do not retaliate against good-faith security researchers. If you
  follow this disclosure process, we work with you, full stop.

## Encryption / signing

Releases on npm are signed by the npm registry's automatic provenance
mechanism (when published from a verified CI workflow). Verify a
release's provenance:

```bash
npm audit signatures @vibeguard-dev/local
```

PGP-signed reports for sensitive disclosures: PGP key available at
`<TODO: security.txt URL — set before public launch>`.

## Our commitments

- Every release ships from a documented CI workflow with a verifiable
  build chain
- Direct dependencies are audited at every release; production runtime
  dependencies are kept to one (`libpg-query` peer dep) intentionally
- Every CHANGELOG entry tied to a security fix includes a CVE reference
  when one is assigned
