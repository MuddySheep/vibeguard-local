import './SampleGallery.css';

import type { Sample } from '../samples.js';

export interface SampleGalleryProps {
  /** All samples (typically `SAMPLES` from samples.ts). */
  readonly samples: readonly Sample[];
  /** Currently-active sample's code (matches Sample.code), if any. */
  readonly activeCode?: string;
  /** Click handler — called with the chosen sample. */
  readonly onPick: (sample: Sample) => void;
}

/**
 * Compact pill-row gallery — one chip per catch. Click a chip to
 * load its preset SQL into the editor.
 */
export function SampleGallery({ samples, activeCode, onPick }: SampleGalleryProps) {
  return (
    <div className="vg-gallery" role="toolbar" aria-label="Sample gallery">
      <span className="vg-gallery__label">samples</span>
      <ul className="vg-gallery__list">
        {samples.map((s) => {
          const isActive = activeCode === s.code;
          const cls = isActive
            ? 'vg-gallery__chip vg-gallery__chip--active'
            : 'vg-gallery__chip';
          return (
            <li key={s.code}>
              <button
                type="button"
                className={cls}
                onClick={() => onPick(s)}
                title={s.description}
                aria-label={`Load ${s.code} — ${s.title}`}
                aria-pressed={isActive}
              >
                {s.code}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
