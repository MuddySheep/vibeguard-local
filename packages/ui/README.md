# @vibeguard-dev/ui

> **Shared design system for VibeGuard surfaces.**
> Tokens + React components used by the OSS playground (and optionally any other surface that wants the same look).

[![npm version](https://img.shields.io/npm/v/@vibeguard-dev/ui)](https://www.npmjs.com/package/@vibeguard-dev/ui)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

---

## What's in the box

A tiny React component library plus a CSS token sheet. Versioned independently from the SDK — `0.x` while the surface is settling, `1.0` once it's locked.

**Tokens** (`@vibeguard-dev/ui/tokens.css`):
- Color: `--vg-bg`, `--vg-ink`, `--vg-ink-2…4`, `--vg-line`, `--vg-acc`, `--vg-bad`, `--vg-warn`, `--vg-info`
- Atmosphere: `--vg-orb-1…3` for the mesh background
- Radii: `--vg-r-sm | -md | -lg`
- Easings: `--vg-ease-out`, `--vg-ease-spring`, `--vg-ease-out-expo`
- Type stack: `--vg-sans` (Geist), `--vg-mono` (Geist Mono), `--vg-serif` (Instrument Serif)

Every token has a dark + light value. Toggle by setting `data-theme="light"` (or `"dark"`) on any container, scoped to that subtree.

**Components**:

| Component | What it does |
|---|---|
| `Mesh` | Fixed-position radial-gradient atmosphere |
| `Grain` | SVG-noise overlay (subtle film texture) |
| `Reveal` | Fade-in-on-scroll wrapper (IntersectionObserver) |
| `SeverityBadge` | Color-coded pill: `block` / `warn` / `info` / `allow` |
| `CatchCard` | Full display card for one VibeGuard catch (composes the badge) |
| `CodeBlock` | Plain `<pre><code>` with the design language; bring your own highlighter |
| `ThemeToggle` | Sun/moon button persisting `data-theme` in `localStorage` |
| `Nav`, `NavCta` | Top nav pill and matched CTA buttons |

## Install

```bash
npm install @vibeguard-dev/ui react react-dom
```

React 18 or 19 are accepted via the peer-dep range.

## Use

In your app entry (e.g. `main.tsx`):

```ts
import '@vibeguard-dev/ui/tokens.css';     // CSS custom properties
import '@vibeguard-dev/ui/global.css';      // optional reset
import '@vibeguard-dev/ui/styles.css';      // bundled component styles
```

Then anywhere in your tree:

```tsx
import { Mesh, Grain, ThemeToggle, CatchCard } from '@vibeguard-dev/ui';

export function App() {
  return (
    <>
      <Mesh />
      <Grain />
      <header style={{ display: 'flex', justifyContent: 'flex-end', padding: 16 }}>
        <ThemeToggle />
      </header>
      <main>
        <CatchCard
          code="SQL-005"
          title="NULL comparison footgun"
          severity="warn"
          confidence={95}
          detail="WHERE col = NULL never matches; use IS NULL."
          fix="Replace `= NULL` with `IS NULL`."
          threatCategories={['corruption']}
        />
      </main>
    </>
  );
}
```

## Theming

```tsx
// switch the entire app to light theme
<html data-theme="light">…</html>

// or scope to a subtree
<section data-theme="light">…</section>
```

Or use the `<ThemeToggle />` component — it writes `data-theme` on `<html>` and persists in localStorage. Pass `target` prop to scope the write to a different element.

## License

Apache 2.0. See [LICENSE](./LICENSE).

Built alongside [`@vibeguard-dev/local`](https://www.npmjs.com/package/@vibeguard-dev/local) and [`eslint-plugin-vibeguard`](https://www.npmjs.com/package/eslint-plugin-vibeguard) — same authors, same license, same ecosystem.
