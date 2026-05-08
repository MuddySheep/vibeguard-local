# Changelog

All notable changes to `@vibeguard-dev/ui` will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This package versions independently from the SDK; pre-1.0 internal-API
breakage between minor versions is allowed (consumers in this
workspace are pinned and validated together).

## [0.1.0] - 2026-05-08

First release. The shared design system that the OSS playground
(`apps/playground`) consumes. Authors who want a VibeGuard-styled
surface — playground, dashboard, custom landing page — can pull
this package and get tokens + components in one import.

### Added

- **Design tokens** (`tokens.css`): full color / line / radii /
  easing / type scale, with dark + light themes wired via
  `data-theme="dark|light"` on any container. All custom
  properties prefixed `--vg-` to avoid collision with consumer
  systems.
- **Global stylesheet** (`global.css`): optional base reset +
  body styles + selection / focus-ring polish. Ships separately
  so consumers can opt out and use just the tokens.
- **Layout primitives:**
  - `Mesh` — fixed-position radial-gradient atmosphere using
    `--vg-orb-1…3`.
  - `Grain` — fixed-position SVG-noise texture overlay (encoded
    inline; no fetch).
  - `Reveal` — fade + translate + blur into view on scroll
    (IntersectionObserver, single-fire). Respects
    `prefers-reduced-motion`.
- **Display components:**
  - `SeverityBadge` — pill with colored dot, label, optional
    confidence number. One of `block` / `warn` / `info` / `allow`.
  - `CatchCard` — full card composition for a single VibeGuard
    catch: code, title, severity badge, location, detail, fix,
    threat-category tags. Optional `onActivate` makes the card
    a button (Enter / Space / click all activate).
  - `CodeBlock` — plain `<pre><code>` with the design aesthetic.
    Host-agnostic (no built-in syntax highlighting; pair with a
    real highlighter at the app level if you need one).
- **Chrome:**
  - `Nav` + `NavCta` — top nav pill with glass-morphism
    backdrop, plus matched CTA buttons (`primary` / `ghost`).
  - `ThemeToggle` — sun/moon button writing `data-theme` on
    `<html>` (or a custom target) and persisting in
    `localStorage`. Honors `defaultTheme`, custom storage key,
    and `null` to disable persistence.
- **Tests** (vitest + @testing-library/react + happy-dom): 38
  tests covering badge color mapping, catch-card composition +
  activation, theme-toggle storage / target / onChange branches,
  Reveal IntersectionObserver wiring, Mesh/Grain/CodeBlock/Nav
  render paths.

### Architecture notes

- **CSS co-located.** Each component lives next to its `.css`;
  tsup → esbuild bundles all `.css` imports into `dist/index.css`.
  Consumers import the bundle once via
  `@vibeguard-dev/ui/styles.css`.
- **ESM-only.** No CJS. Modern bundlers (Vite, webpack, Rollup)
  resolve ESM and tree-shake.
- **Peer-dep React.** `react@^18 || ^19` and matching
  `react-dom`. The package itself depends on neither.
- **Token prefix.** Every CSS custom property is `--vg-…` so the
  package can be dropped into a consumer that already uses other
  design tokens without collision.

### Stability

This is a pre-1.0 release. Internal API breakage between minor
versions is allowed; the surface stabilizes once the OSS
playground (V1.5) ships and a couple of external consumers
validate the API shape.

## Related

- [`@vibeguard-dev/local`](https://www.npmjs.com/package/@vibeguard-dev/local) — the SDK whose catches this package displays.
- [`eslint-plugin-vibeguard`](https://www.npmjs.com/package/eslint-plugin-vibeguard) — sibling package wrapping the SDK as an ESLint rule.
