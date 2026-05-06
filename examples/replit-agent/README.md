# Replit Agent integration

> **The meta-loop.** Replit Agent built VibeGuard. Now Replit Agent
> uses VibeGuard.

This example shows how to plug `@vibeguard-dev/local` into a Replit-
style agent's database-tool execution path as a pre-flight safety
check.

## What this example does

`createVibeGuardHook(options?)` returns a synchronous-friendly
function that takes an SQL string and returns
`{ allowed, sql, catches, feedback }`. The agent runtime calls the
hook BEFORE executing each LLM-emitted SQL statement and branches
on `allowed`:

- `allowed: true` → run the SQL against the database
- `allowed: false` → don't run; pass `feedback` (a pre-formatted
  catch list) back to the agent's LLM as next-attempt context

The hook does NOT own the retry loop — the agent runtime does.
That's the difference from STORY 4.2 (Claude Code): the Claude Code
wrapper retries internally; this hook returns advisory data and
lets the agent's existing LLM-call infrastructure do the retry.

## Why this pattern (vs Claude Code / Cursor)

Three SDK-integration patterns, three different ownership models:

| Pattern | Owns retry? | Wraps what? |
|---|---|---|
| **Claude Code** (`generateSafeSQL`) | Yes — internal retry loop | The LLM call |
| **Cursor** (`withVibeGuard`) | No — caller acts on result | The execute call |
| **Replit Agent** (`createVibeGuardHook`) | No — caller acts on `feedback` | Just the analysis |

Use the Replit Agent pattern when:

- Your agent runtime already has a retry / feedback mechanism you
  can hand off to (Replit Agent, MCP servers, custom agents).
- You want VibeGuard to be a pure advisory layer — produces a
  decision and a feedback string, doesn't own any control flow.
- You're embedding the safety check deep inside an existing agent
  runtime where adding nested async / retry logic would conflict
  with the runtime's own loop.

## The meta-loop framing

VibeGuard the cloud product was built with Replit Agent. The same
Replit Agent that built VibeGuard can now use this SDK to pre-flight
every SQL query it generates — protecting itself (and its users)
from the same anti-patterns it might otherwise produce.

That's the meta-loop: an LLM-driven coding agent uses an LLM-safety
SDK that itself was authored by an LLM-driven coding agent. Recursive
safety; recursive trust.

## Run it

From this directory:

```bash
# In the SDK root first, build dist/ that the example links against:
cd ../..
npm run build

# Back in this example dir:
cd examples/replit-agent
npm install
npm test
```

The tests use the SDK directly (no LLM calls; no database
connection) and verify the hook's behavior across allowed /
blocked / parse-error paths plus configuration variants.

## Wiring into an agent runtime

```ts
import { init } from '@vibeguard-dev/local';
import { createVibeGuardHook } from './src/replit-agent-hook.js';

await init(); // one-time WASM-parser load

// Configure once at agent startup:
const safetyCheck = createVibeGuardHook({
  blockOn: 'block',          // 'block' | 'warn' | 'info'
  maxFeedbackChars: 2048,    // truncates feedback to fit LLM context
});

// Inside the agent's database-tool execute path:
async function runSQL(sql: string, ctx: AgentContext) {
  const safe = safetyCheck(sql);

  if (!safe.allowed) {
    // Hand off to the agent's existing retry mechanism. The agent
    // runtime decides whether to:
    //   - Re-prompt the LLM with safe.feedback as context
    //   - Surface the catches in the UI for human review
    //   - Escalate to a human-in-the-loop reviewer
    return ctx.retryWithFeedback({
      reason: 'vibeguard-blocked',
      feedback: safe.feedback,
      catches: safe.catches,
    });
  }

  // Allowed — run the SQL. Surface advisory catches alongside results.
  const rows = await ctx.db.query(safe.sql);
  return {
    rows,
    advisoryCatches: safe.catches.filter((c) => c.severity !== 'block'),
  };
}
```

## Configuration

```ts
createVibeGuardHook({
  blockOn: 'block',          // severity threshold for allowed=false
  maxFeedbackChars: 2048,    // 0 disables truncation
});
```

- **`blockOn`** controls when `allowed` becomes false. `'block'`
  blocks only on block-severity catches (default). `'warn'` also
  blocks on warn. `'info'` blocks on anything.
- **`maxFeedbackChars`** caps the formatted feedback string length
  so it doesn't blow the LLM's context budget. Default 2048
  (typically 1-3 catches with full detail). Set to 0 to disable
  truncation.

## License

This example is part of `@vibeguard-dev/local`, licensed under
[Apache 2.0](../../LICENSE).
