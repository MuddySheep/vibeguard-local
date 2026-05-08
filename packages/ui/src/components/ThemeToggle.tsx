import './ThemeToggle.css';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

export interface ThemeToggleProps {
  /**
   * Where to write the theme attribute. Default: `document.documentElement`
   * (the `<html>` tag), which is the broadest scope. Pass a specific
   * element ref if you want theme-toggle to affect only a subtree.
   */
  readonly target?: HTMLElement | null;
  /**
   * localStorage key used to persist the user's choice across reloads.
   * Default: `'vg-theme'`. Pass `null` to disable persistence.
   */
  readonly storageKey?: string | null;
  /**
   * Initial theme if nothing is stored. Default: `'dark'`.
   */
  readonly defaultTheme?: Theme;
  /**
   * Optional className appended to the root.
   */
  readonly className?: string;
  /**
   * Optional callback fired whenever the theme changes (after the
   * DOM attribute has been updated).
   */
  readonly onChange?: (next: Theme) => void;
}

const STORAGE_DEFAULT = 'vg-theme';

function readInitial(
  storageKey: string | null,
  defaultTheme: Theme,
): Theme {
  if (storageKey === null) return defaultTheme;
  if (typeof window === 'undefined') return defaultTheme;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage may be unavailable (private mode, denied) */
  }
  return defaultTheme;
}

/**
 * Sun/moon button toggling between dark and light themes. Writes
 * `data-theme` on the target element (default: `<html>`) and
 * persists the choice in localStorage.
 *
 * The component is uncontrolled — internal state is the source of
 * truth. If you need controlled behavior, build it from the
 * exported `Theme` type and your own state.
 */
export function ThemeToggle({
  target,
  storageKey = STORAGE_DEFAULT,
  defaultTheme = 'dark',
  className,
  onChange,
}: ThemeToggleProps) {
  const effectiveStorageKey = storageKey ?? null;
  const [theme, setTheme] = useState<Theme>(() =>
    readInitial(effectiveStorageKey, defaultTheme),
  );

  useEffect(() => {
    const el = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
    if (!el) return;
    el.setAttribute('data-theme', theme);
    if (effectiveStorageKey !== null && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(effectiveStorageKey, theme);
      } catch {
        /* localStorage may fail silently */
      }
    }
    onChange?.(theme);
  }, [theme, target, effectiveStorageKey, onChange]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const cls = className
    ? `vg-theme-toggle ${className}`
    : 'vg-theme-toggle';

  return (
    <button
      type="button"
      className={cls}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      data-theme={theme}
    >
      <span className="vg-theme-toggle__icon" aria-hidden="true">
        {theme === 'dark' ? (
          /* Sun glyph (we are in dark mode → click moves us to light → show sun) */
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          /* Moon glyph */
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </span>
    </button>
  );
}
