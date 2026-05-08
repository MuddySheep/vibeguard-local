import './Reveal.css';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface RevealProps {
  /** Content to fade-in once it scrolls into view. */
  readonly children: ReactNode;
  /**
   * Stagger delay in ms applied as transition-delay. Use to chain
   * multiple Reveal blocks (e.g. 0, 80, 160 ms).
   */
  readonly delay?: number;
  /**
   * Threshold passed to IntersectionObserver. Range 0..1; default
   * 0.15 — fires once 15% of the element is visible.
   */
  readonly threshold?: number;
  /**
   * Additional className on the wrapping element.
   */
  readonly className?: string;
}

/**
 * Fade + translateY + blur into view on scroll. Once revealed, the
 * `.in` class persists — re-scrolling does not re-trigger.
 *
 * Implementation: IntersectionObserver, with a graceful fallback
 * for environments lacking it (the `.in` class is applied at mount
 * so content is visible).
 */
export function Reveal({
  children,
  delay,
  threshold = 0.15,
  className,
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('in');
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('in');
            obs.disconnect();
            break;
          }
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  const style = delay !== undefined ? { transitionDelay: `${delay}ms` } : undefined;
  const cls = className ? `vg-reveal ${className}` : 'vg-reveal';

  return (
    <div ref={ref} data-reveal className={cls} {...(style ? { style } : {})}>
      {children}
    </div>
  );
}
