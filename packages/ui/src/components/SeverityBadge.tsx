import './SeverityBadge.css';

/** Severity values that the badge knows how to style. */
export type Severity = 'block' | 'warn' | 'info' | 'allow';

export interface SeverityBadgeProps {
  /** Which severity to render. */
  readonly severity: Severity;
  /**
   * Optional confidence number (0..100) appended after the severity
   * label, e.g. "block · 99".
   */
  readonly confidence?: number;
  /** Optional override label text. Defaults to the severity name. */
  readonly label?: string;
  /** Optional className appended to the root. */
  readonly className?: string;
}

const DEFAULT_LABEL: Record<Severity, string> = {
  block: 'block',
  warn: 'warn',
  info: 'info',
  allow: 'allow',
};

/**
 * Pill component encoding a catch's severity. Color-coded against
 * the design tokens:
 *   block → --vg-bad
 *   warn  → --vg-warn
 *   info  → --vg-info
 *   allow → --vg-acc (green; signals "safe / passed")
 *
 * Use inside CatchCard or any catch-listing surface.
 */
export function SeverityBadge({
  severity,
  confidence,
  label,
  className,
}: SeverityBadgeProps) {
  const text = label ?? DEFAULT_LABEL[severity];
  const cls = className
    ? `vg-severity-badge vg-severity-badge--${severity} ${className}`
    : `vg-severity-badge vg-severity-badge--${severity}`;
  return (
    <span
      className={cls}
      role="status"
      aria-label={`Severity: ${text}${confidence !== undefined ? `, confidence ${confidence}` : ''}`}
    >
      <span className="vg-severity-badge__dot" aria-hidden="true" />
      <span className="vg-severity-badge__label">{text}</span>
      {confidence !== undefined ? (
        <>
          <span className="vg-severity-badge__sep" aria-hidden="true">·</span>
          <span className="vg-severity-badge__confidence">{confidence}</span>
        </>
      ) : null}
    </span>
  );
}
