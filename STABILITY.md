# Stability commitments

`@vibeguard-dev/local` is designed to be safe for production use. This
document is the contract: what changes when, and what we promise to
keep stable forever.

## Catch IDs are forever-stable

Once a catch ID like `SQL-001` ships in a public release, that ID always
means the same thing. Specifically:

- **An ID is never reused.** If a catch is removed from the SDK (rare,
  but possible), its ID is permanently retired. The next new catch
  gets the next number, never the retired one.
- **The threat shape an ID represents stays consistent.** `SQL-003`
  ("Unbounded UPDATE / DELETE") will always be about unbounded
  destructive writes. We can refine the detection logic, but the
  category meaning stays.
- **Customers can write `if (catch.code === 'SQL-003')` and rely on it.**
  That's the whole point of stable IDs.

If you depend on a catch's behavior in your code, the ID is the right
thing to key on.

## Severity changes are major-version only

If a catch's severity changes (e.g., `warn` → `block`), that's a major
version bump. Customers shouldn't be surprised by a catch suddenly
blocking what previously only warned.

The reverse (`block` → `warn`) is also major-version. Either direction
is a behavior change that consumers may have built logic around.

## Confidence range adjustments are minor versions

A catch's confidence range can be tightened (e.g., 70–85 → 75–85) or
expanded (e.g., 70–85 → 65–90) in minor versions, as long as the
direction makes sense for the rule's actual detection accuracy.

## Detection-logic improvements are minor versions

If a rule starts catching new edge cases or handling false positives
better, that's a minor version bump. The catch's identity doesn't change
— it's still detecting the same threat shape — it just does it more
accurately.

## Bug fixes are patch versions

Pure bugs (panics, type errors, incorrect output structure) are patch
versions.

## Public API surface stays minimal

The SDK's public API is small on purpose:

- `analyze(sql, options?) → AnalysisResult`
- The `Catch` and `AnalysisResult` types
- The `RULES` registry (read-only)
- The substrate helpers (`astWalk`, `extractFromTables`,
  `extractColumns`) — exposed for users who want to write their own
  static checks using the same primitives

Adding to this surface is a minor version. Removing or renaming
anything in it is a major version.

## Peer-dependency policy

`libpg-query` is the only required peer dependency. Major version
changes to `libpg-query` (which represent Postgres parser version
updates) are major versions of this SDK as well — even if our public
API doesn't change — because the AST shapes the SDK reasons over may
have shifted.

## How to depend on this SDK in production

- Use a caret range in `package.json` (`"@vibeguard-dev/local": "^1.0.0"`)
- Pin to a specific version if you want zero auto-updates
- Watch the [CHANGELOG](./CHANGELOG.md) for the once-a-quarter
  major-version cadence we plan to maintain (no surprise majors)
