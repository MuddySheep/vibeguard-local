# VibeGuard playground

> **Paste SQL, see what VibeGuard catches.**
> Runs entirely in your browser via WASM — no data leaves your machine.

The playground is the marketing front-door for the VibeGuard analyzer. Drop a query in, see the verdict on the right, share via URL.

Live (post-deploy): **https://muddysheep.github.io/vibeguard-local/**

---

## Local development

```bash
# from the repo root
pnpm install
pnpm --filter @vibeguard-dev/playground dev
```

Then open `http://localhost:5173`.

The first paint loads the libpg-query WASM bundle (~1 MB). After it lands, every keystroke parses + runs the rules synchronously.

## Build

```bash
pnpm --filter @vibeguard-dev/playground build
pnpm --filter @vibeguard-dev/playground preview
```

`build` outputs static files to `dist/`. `preview` serves them on `:4173`.

## What it does

- **CodeMirror 6** SQL editor (Postgres syntax highlight, line wrapping, line numbers).
- **WASM analyzer.** Loads libpg-query directly in the browser, then runs the SDK's 15 rules against the parsed AST. Same verdicts you'd get from `analyze()` in Node.
- **Sample gallery.** One preset SQL per catch — click `SQL-001` to see the cartesian-explosion sample, `SQL-013` for DROP TABLE, etc. The `SQL-014` sample auto-enables that default-OFF rule on selection.
- **AST viewer** (toggle). Hand-rolled collapsible JSON tree; useful for understanding what the parser saw.
- **Share via URL.** The `share` button gzip+base64-encodes the editor's contents into the URL hash and copies it to your clipboard. Visiting that URL pre-fills the editor.
- **Dark/light toggle.** Persists in `localStorage`.

## What it deliberately does NOT do

(Reinforces the moat: `_bmad/output/oss-roadmap/spec.md` §3.)

- No audit log, no HITL UI, no hash-chain badge, no receipt-style framing.
- No estimated row count, no blast-radius visualization.
- No upsell modal blocking the paste-and-analyze flow.
- No analytics / telemetry. The page ships zero scripts beyond the playground itself.

## Architecture

```
apps/playground/
├── src/
│   ├── main.tsx            React entry; loads design tokens + bundled CSS.
│   ├── App.tsx             Top-level layout, state, sample wiring.
│   ├── App.css
│   ├── analyzer.ts         Browser-side init + analyze (libpg-query → SDK rules).
│   ├── share.ts            gzip+base64url URL hash encode/decode.
│   ├── samples.ts          15 catch-keyed presets.
│   ├── main.css            Page-only globals (font import, html/body sizing).
│   └── components/
│       ├── Editor.tsx, .css            CodeMirror 6 wrapper.
│       ├── editor-theme.ts             CM6 themes bound to design tokens.
│       ├── ResultsPanel.tsx, .css      Right-pane catch list (loading / idle / clean / catches).
│       ├── AstViewer.tsx, .css         Collapsible JSON tree.
│       └── SampleGallery.tsx, .css     Click-to-load chip row.
├── tests/
│   ├── test-share.test.ts          Round-trip + URL-safety + malformed handling.
│   └── test-samples.test.ts        Codes/coverage/forceEnable sanity.
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── index.html
└── package.json
```

The pure-logic tests (`share`, `samples`) run in vitest + happy-dom. The analyzer wiring is exercised end-to-end by the dev server / built artifact (libpg-query needs a real browser to evaluate the WASM).

## Browser-side WASM, in three steps

The SDK's `parser.ts` uses `createRequire(import.meta.url)` — Node-only. The playground uses libpg-query's browser-friendly ESM entry directly:

```ts
import { loadModule, parseSync } from 'libpg-query';
import { runRules, RULE_REGISTRY } from '@vibeguard-dev/local';

await loadModule();              // once at app start
const ast = parseSync(sql);      // sync per query
const catches = runRules(ast,
  RULE_REGISTRY.filter(e => e.defaultEnabled).map(e => e.rule));
```

The SDK's `runRules` is pure JS — works in any environment. We feed it an AST that the playground produced via the browser-side parser. No fork of analysis logic; same 15 catches as the CLI.

## Deploy

GitHub Actions (`.github/workflows/playground-deploy.yml`) builds and pushes to `gh-pages` on every push to `main` that touches `apps/playground/`, `packages/sdk/`, or `packages/ui/`.

`Settings → Pages → Source: GitHub Actions` (one-time).

## License

Apache 2.0 — same as the rest of the workspace. See [LICENSE](../../LICENSE).
