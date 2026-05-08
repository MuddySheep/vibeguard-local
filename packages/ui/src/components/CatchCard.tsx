import './CatchCard.css';

import { SeverityBadge, type Severity } from './SeverityBadge.js';

export interface CatchCardProps {
  /** Stable identifier for the catch (e.g. "SQL-005"). */
  readonly code: string;
  /** Short, human-readable title. */
  readonly title: string;
  /** Severity level — drives the badge + left-edge accent color. */
  readonly severity: Severity;
  /** Confidence value 0..100. Rendered alongside the severity. */
  readonly confidence?: number;
  /** Long-form description of what the catch detected. */
  readonly detail: string;
  /** Recommended remediation. Optional — some catches have no fix prose. */
  readonly fix?: string;
  /** Threat categories (e.g. ["destruction", "corruption"]). */
  readonly threatCategories?: readonly string[];
  /**
   * Optional source-region label (e.g. "line 21" or "line 21:12"). Useful
   * when displaying a catch attached to a known source location.
   */
  readonly location?: string;
  /** Optional className appended to the root. */
  readonly className?: string;
  /**
   * Optional click handler — wraps the card in a button-styled
   * activation surface. Pass when the card is meant to drive editor
   * navigation (e.g. "click to jump to source").
   */
  readonly onActivate?: () => void;
}

/**
 * Display card for a single VibeGuard catch. Composes:
 *   - SeverityBadge (colored pill)
 *   - Code + title row
 *   - Detail prose
 *   - Optional fix prose
 *   - Optional threat-category tags
 *
 * Severity drives the left-edge accent stripe via CSS.
 */
export function CatchCard({
  code,
  title,
  severity,
  confidence,
  detail,
  fix,
  threatCategories,
  location,
  className,
  onActivate,
}: CatchCardProps) {
  const cls = className
    ? `vg-catch-card vg-catch-card--${severity} ${className}`
    : `vg-catch-card vg-catch-card--${severity}`;

  const handleClick = onActivate
    ? () => onActivate()
    : undefined;

  const handleKey = onActivate
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }
    : undefined;

  // Use Record<string, unknown>-typed spread to satisfy
  // exactOptionalPropertyTypes when conditionally adding click
  // handler / role.
  const activationProps = onActivate
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: handleKey,
      }
    : {};

  return (
    <div className={cls} {...activationProps}>
      <header className="vg-catch-card__head">
        <div className="vg-catch-card__id-block">
          <code className="vg-catch-card__code">{code}</code>
          <h3 className="vg-catch-card__title">{title}</h3>
        </div>
        <SeverityBadge
          severity={severity}
          {...(confidence !== undefined ? { confidence } : {})}
        />
      </header>

      {location !== undefined ? (
        <div className="vg-catch-card__location">{location}</div>
      ) : null}

      <p className="vg-catch-card__detail">{detail}</p>

      {fix !== undefined ? (
        <div className="vg-catch-card__fix">
          <span className="vg-catch-card__fix-label">Fix</span>
          <span className="vg-catch-card__fix-text">{fix}</span>
        </div>
      ) : null}

      {threatCategories && threatCategories.length > 0 ? (
        <div className="vg-catch-card__tags">
          {threatCategories.map((cat) => (
            <span key={cat} className="vg-catch-card__tag">
              {cat}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
