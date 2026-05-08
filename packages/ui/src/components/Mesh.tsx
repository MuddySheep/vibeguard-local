import './Mesh.css';

import type { CSSProperties } from 'react';

export interface MeshProps {
  /**
   * Optional className appended to the root. Useful for additional
   * positioning or z-index tweaks.
   */
  readonly className?: string;
  /** Inline style overrides. */
  readonly style?: CSSProperties;
}

/**
 * Ambient atmospheric background — three radial-gradient orbs in
 * the brand palette. Position: fixed (sticks to viewport).
 *
 * Render once near the top of the app tree:
 *
 *   <Mesh />
 *   <main>...</main>
 *
 * Pointer events pass through; z-index 0 (sits behind app content
 * but above body background).
 */
export function Mesh({ className, style }: MeshProps) {
  return (
    <div
      aria-hidden="true"
      className={className ? `vg-mesh ${className}` : 'vg-mesh'}
      style={style}
    />
  );
}
