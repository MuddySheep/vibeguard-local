import './Grain.css';

export interface GrainProps {
  /**
   * Opacity override. Default: 0.045 (subtle SVG noise overlay).
   * Range 0..1.
   */
  readonly opacity?: number;
}

/**
 * Subtle SVG-noise texture overlay. Sits at z-index 60 above
 * everything except modals; pointer-events pass through. Adds
 * tactile grain to flat backgrounds without becoming visual noise.
 *
 * The SVG is a fractal-noise pattern encoded inline (no fetch).
 * Render once near the top of the app tree (below modals).
 */
export function Grain({ opacity }: GrainProps) {
  if (opacity === undefined) {
    return <div aria-hidden="true" className="vg-grain" />;
  }
  return (
    <div
      aria-hidden="true"
      className="vg-grain"
      style={{ opacity }}
    />
  );
}
