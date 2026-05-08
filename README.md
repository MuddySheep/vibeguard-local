# vibeguard-local

Monorepo for the open-source VibeGuard SDK and its ecosystem.

## Packages

- **[`@vibeguard-dev/local`](./packages/sdk)** — Static SQL safety analyzer for AI agents. 12 catches, sub-millisecond, zero network calls. Published on [npm](https://www.npmjs.com/package/@vibeguard-dev/local).

## Coming soon

- `eslint-plugin-vibeguard` — ESLint plugin for tagged template literals
- `@vibeguard-dev/ui` — Shared design system

## Apps

- `playground` — Web playground for the analyzer (deploys to GitHub Pages)

## Development

This is a [pnpm workspace](https://pnpm.io/workspaces). Install [pnpm](https://pnpm.io/installation) (or run `corepack enable` to use the version pinned in `package.json`), then:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The shipping SDK lives in [`packages/sdk/`](./packages/sdk). See its README for end-user documentation.

## License

Apache 2.0. See [LICENSE](./LICENSE).
