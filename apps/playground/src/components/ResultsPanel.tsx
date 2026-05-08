import './ResultsPanel.css';

import type { Catch } from '@vibeguard-dev/local';
import { CatchCard, SeverityBadge, type Severity } from '@vibeguard-dev/ui';

export interface ResultsPanelProps {
  /** The catches returned by the analyzer (already in registry order). */
  readonly catches: Catch[];
  /** Optional parse error to display instead of catches. */
  readonly parseError?: { readonly message: string; readonly cursorPosition?: number };
  /** True before init has resolved — renders a loading state. */
  readonly loading?: boolean;
  /** Whether SQL was empty / hadn't been analyzed yet. */
  readonly idle?: boolean;
}

/**
 * Right-pane catch list. Three states:
 *   - loading (init() pending)
 *   - parse error (display-only)
 *   - catches (zero or more CatchCards)
 *   - idle (initial state, no SQL entered)
 */
export function ResultsPanel({
  catches,
  parseError,
  loading,
  idle,
}: ResultsPanelProps) {
  if (loading === true) {
    return (
      <div className="vg-results vg-results--loading">
        <div className="vg-results__spinner" aria-hidden="true" />
        <p className="vg-results__msg">
          Loading parser… <span className="vg-results__hint">(WASM, one-time)</span>
        </p>
      </div>
    );
  }

  if (parseError !== undefined) {
    return (
      <div className="vg-results vg-results--error">
        <SeverityBadge severity="block" label="parse error" />
        <p className="vg-results__msg">{parseError.message}</p>
        {parseError.cursorPosition !== undefined ? (
          <p className="vg-results__hint">
            cursor position {parseError.cursorPosition}
          </p>
        ) : null}
      </div>
    );
  }

  if (idle === true) {
    return (
      <div className="vg-results vg-results--idle">
        <p className="vg-results__msg">
          Paste SQL on the left or pick a sample to see the analysis.
        </p>
      </div>
    );
  }

  if (catches.length === 0) {
    return (
      <div className="vg-results vg-results--clean">
        <SeverityBadge severity="allow" label="no catches" />
        <p className="vg-results__msg">
          Nothing to flag. The query parses cleanly and none of the
          15 default-on rules fired.
        </p>
        <p className="vg-results__hint">
          Tip: edit the SQL on the left to see catches appear in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="vg-results vg-results--list">
      <header className="vg-results__head">
        <span className="vg-results__count">
          {catches.length} {catches.length === 1 ? 'catch' : 'catches'}
        </span>
        <span className="vg-results__sep" aria-hidden="true">·</span>
        <span className="vg-results__hint">
          {countBlock(catches)} blocking · {countWarn(catches)} warn · {countInfo(catches)} info
        </span>
      </header>
      <ul className="vg-results__list">
        {catches.map((c, idx) => (
          <li key={`${c.code}-${idx}`}>
            <CatchCard
              code={c.code}
              title={c.title}
              severity={c.severity as Severity}
              confidence={c.confidence}
              detail={c.detail}
              fix={c.fix}
              {...(c.threatCategories ? { threatCategories: c.threatCategories } : {})}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function countBlock(catches: Catch[]): number {
  return catches.filter((c) => c.severity === 'block').length;
}
function countWarn(catches: Catch[]): number {
  return catches.filter((c) => c.severity === 'warn').length;
}
function countInfo(catches: Catch[]): number {
  return catches.filter((c) => c.severity === 'info').length;
}
