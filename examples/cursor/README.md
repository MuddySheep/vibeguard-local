# Cursor integration

Pre-flight SQL execution wrapper for Cursor agents (or any
LLM-driven SQL pipeline that wants a guard between "agent emitted
SQL" and "SQL hits the database").

## What this example does

`withVibeGuard(execute)` wraps any function that takes SQL and
returns a result. The wrapper:

1. Calls `analyze(sql)` from `@vibeguard-dev/local` BEFORE invoking
   the underlying `execute`.
2. If a `block`-severity catch fires (default), returns
   `{ status: 'blocked', catches }` and **does not call execute**.
3. If only `warn` / `info` catches fire, runs `execute` and returns
   `{ status: 'executed', result, catches }` so the caller can
   surface the warnings in their UI.
4. On parser failure, returns `{ status: 'parse-error', message }`
   without calling `execute`.

## Why this pattern (vs the Claude Code retry pattern)

The two examples solve different problems:

- **Claude Code (`generateSafeSQL`)** wraps the **generation** step.
  It re-asks the LLM with structured feedback when block-severity
  catches fire. Useful when you control the LLM call directly.
- **Cursor (`withVibeGuard`)** wraps the **execution** step. It
  blocks unsafe SQL from reaching the database and returns a
  structured result the agent's existing retry logic can act on.
  Useful when the LLM call is buried inside the agent runtime
  (Cursor's agent loop, MCP server, etc.) and you only get a hook
  on the database side.

Real systems often use **both** — a generation-time retry to drive
self-correction AND an execution-time guard so the database is
protected even if generation slips.

## Run it

From this directory:

```bash
# In the SDK root first, build dist/ that the example links against:
cd ../..
npm run build

# Back in this example dir:
cd examples/cursor
npm install
npm test
```

The tests use Vitest's `vi.fn()` to mock the `execute` function and
verify the guard's behavior — no database connection needed.

## Wiring into Cursor

Cursor's agent flow varies by version. The integration shape is:

```ts
import { init } from '@vibeguard-dev/local';
import { withVibeGuard } from './src/cursor-tool.js';

await init(); // one-time WASM-parser load

// Wherever your Cursor agent's "run SQL" tool lives:
const safeRunSQL = withVibeGuard(async (sql: string) => {
  return await db.query(sql);
});

// Use safeRunSQL in place of the raw execute. Inspect the result:
const r = await safeRunSQL(agentEmittedSQL);
switch (r.status) {
  case 'executed':
    return { ok: true, rows: r.result.rows, warnings: r.catches };
  case 'blocked':
    return {
      ok: false,
      reason: 'safety',
      catches: r.catches.map((c) => `[${c.code}] ${c.title}`),
    };
  case 'parse-error':
    return { ok: false, reason: 'parse', message: r.message };
}
```

The agent's UI can render the `warnings` (warn / info catches that
didn't block) and the `catches` (block-severity catches that did)
differently — green-with-asterisk vs red rejection.

## Configuration

```ts
withVibeGuard(execute, {
  blockOn: 'block',           // 'block' | 'warn' | 'info' (default: 'block')
  onBlock: 'block',           // 'block' | 'execute-with-warning' (default: 'block')
  logger: (msg, catches) => { /* custom logging */ },
});
```

- **`blockOn`** raises or lowers the block threshold. `'warn'` blocks
  on warn-or-block; `'info'` blocks on anything.
- **`onBlock: 'execute-with-warning'`** is a soft mode — fires the
  logger but runs `execute` anyway. Useful when the agent has its
  own escalation policy and you want VibeGuard to be advisory rather
  than authoritative.
- **`logger`** is called with `(msg, catches)` on block events.
  Default is `console.warn`. Pass `() => {}` to suppress.

## License

This example is part of `@vibeguard-dev/local`, licensed under
[Apache 2.0](../../LICENSE).
