# Claude Code integration

Pre-flight SQL safety check + retry-on-block, designed to wrap any
LLM call. The pattern works for the Anthropic SDK, Claude Code's
MCP integration, or any other LLM client that returns SQL text.

## What this example does

1. You ask an LLM to generate SQL given a natural-language prompt.
2. The wrapper calls `analyze(sql)` from `@vibeguard-dev/local`.
3. If any `block`-severity catch fires, the wrapper formats the
   catches as structured feedback and re-asks the LLM with that
   feedback appended.
4. The loop continues until the LLM produces clean SQL or the
   retry budget (default 3) is exhausted.

`warn` and `info` severity catches don't trigger a retry by default
— they're returned alongside the final SQL so the calling code can
log them, surface them in a UI, or apply its own policy. To retry on
warn-or-above, pass `retryOn: 'warn'` in the options.

## Why this pattern

- **Catches early.** The static check fires before the SQL hits a
  database connection — no roundtrip cost on the failure case.
- **Teaches across the conversation.** Feeding catches back as
  structured feedback (code + title + detail + fix) gives the LLM
  enough information to actually self-correct. Without that
  structure, the LLM often regenerates the same shape.
- **Bounded cost.** The retry budget caps token spend.
- **LLM-agnostic.** The wrapper takes a `LLMClient` callback (any
  function from prompt to SQL); the README shows how to bind it to
  the Anthropic SDK below.

## Run it

From this directory:

```bash
# In the SDK root first, build dist/ that the example links against:
cd ../..
npm run build

# Back in this example dir:
cd examples/claude-code
npm install
npm test
```

The tests use a deterministic mock LLM — they verify the retry /
feedback loop without making real Anthropic API calls.

## Wiring the Anthropic SDK

```ts
import Anthropic from '@anthropic-ai/sdk';
import { init } from '@vibeguard-dev/local';
import { generateSafeSQL } from './src/wrapper.js';

await init(); // one-time WASM-parser load

const client = new Anthropic();

const result = await generateSafeSQL(
  "Update Alice's email to alice@new.example",
  async (prompt) => {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('no text in LLM response');
    return block.text.trim();
  },
);

console.log('Final SQL:', result.sql);
console.log('Retries:', result.retries);
console.log('Non-block catches:', result.catches.filter((c) => c.severity !== 'block'));
```

You'll need `ANTHROPIC_API_KEY` set in the environment.

## Performance characteristics

The pre-flight `analyze()` call is sub-millisecond on typical
queries — see the SDK's `benchmarks/baseline.json` for current
numbers. This is negligible compared to the LLM round-trip cost
(typically hundreds of milliseconds), so the safety check adds no
practical latency.

## Production notes

For real production use of Claude Code specifically, prefer the MCP
integration over the direct Anthropic SDK shown here — the MCP
approach scales better to tool-using agents with less plumbing.
The wrapper pattern (LLMClient callback) is the same; only the
`llm` callback's body changes.

## License

This example is part of `@vibeguard-dev/local`, licensed under
[Apache 2.0](../../LICENSE).
