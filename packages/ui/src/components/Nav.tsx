import './Nav.css';

import type { ReactNode } from 'react';

export interface NavProps {
  /** Brand mark / logotype rendered on the left. */
  readonly brand: ReactNode;
  /** Right-side content — typically nav links + CTAs. */
  readonly children?: ReactNode;
  /** Optional className appended to the root. */
  readonly className?: string;
}

/**
 * Top navigation pill. Glass-morphism aesthetic — subtle border,
 * blurred background, sits on top of the Mesh.
 *
 * Layout: brand on the left, children flex-end on the right.
 */
export function Nav({ brand, children, className }: NavProps) {
  const cls = className ? `vg-nav ${className}` : 'vg-nav';
  return (
    <nav className={cls}>
      <div className="vg-nav__brand">{brand}</div>
      <div className="vg-nav__actions">{children}</div>
    </nav>
  );
}

export interface NavCtaProps {
  /** href if rendered as an anchor; absence means render as a button. */
  readonly href?: string;
  /** External target — sets target="_blank" + rel="noopener noreferrer". */
  readonly external?: boolean;
  /** Optional click handler (only honored when no href). */
  readonly onClick?: () => void;
  /** Variant — primary (lime fill) or ghost (outlined). */
  readonly variant?: 'primary' | 'ghost';
  /** Optional className appended to the root. */
  readonly className?: string;
  /** Button content. */
  readonly children: ReactNode;
}

/**
 * Compact CTA button matched to the Nav scale. Renders as `<a>` if
 * href is provided, otherwise `<button type="button">`.
 */
export function NavCta({
  href,
  external,
  onClick,
  variant = 'primary',
  className,
  children,
}: NavCtaProps) {
  const cls = className
    ? `vg-nav-cta vg-nav-cta--${variant} ${className}`
    : `vg-nav-cta vg-nav-cta--${variant}`;

  if (href !== undefined) {
    const externalProps = external
      ? { target: '_blank', rel: 'noopener noreferrer' }
      : {};
    return (
      <a className={cls} href={href} {...externalProps}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
