// @vibeguard-dev/ui — public surface.
//
// Components are CSS-co-located and bundled via tsup → esbuild's
// CSS loader. Consumers import the JS like any normal package and
// also import the bundled stylesheet ONCE at app entry:
//
//   import { Mesh, Grain, CatchCard, SeverityBadge } from '@vibeguard-dev/ui';
//   import '@vibeguard-dev/ui/dist/index.css';   // styles
//   import '@vibeguard-dev/ui/tokens.css';        // CSS custom properties
//   import '@vibeguard-dev/ui/global.css';        // optional reset
//
// All CSS uses the design tokens defined in tokens.css. Without
// tokens.css imported, components will render with browser defaults.

export { Mesh } from './components/Mesh.js';
export type { MeshProps } from './components/Mesh.js';

export { Grain } from './components/Grain.js';
export type { GrainProps } from './components/Grain.js';

export { Reveal } from './components/Reveal.js';
export type { RevealProps } from './components/Reveal.js';

export { SeverityBadge } from './components/SeverityBadge.js';
export type {
  SeverityBadgeProps,
  Severity,
} from './components/SeverityBadge.js';

export { CatchCard } from './components/CatchCard.js';
export type { CatchCardProps } from './components/CatchCard.js';

export { ThemeToggle } from './components/ThemeToggle.js';
export type {
  ThemeToggleProps,
  Theme,
} from './components/ThemeToggle.js';

export { CodeBlock } from './components/CodeBlock.js';
export type { CodeBlockProps } from './components/CodeBlock.js';

export { Nav, NavCta } from './components/Nav.js';
export type { NavProps, NavCtaProps } from './components/Nav.js';
