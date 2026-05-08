import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ThemeToggle } from '../src/components/ThemeToggle.js';

const KEY = 'vg-theme-test';

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  it('writes data-theme=dark by default on mount', () => {
    render(<ThemeToggle storageKey={KEY} />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggles to light on click', () => {
    render(<ThemeToggle storageKey={KEY} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggles back to dark on second click', () => {
    render(<ThemeToggle storageKey={KEY} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists choice to localStorage', () => {
    render(<ThemeToggle storageKey={KEY} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(window.localStorage.getItem(KEY)).toBe('light');
  });

  it('reads initial theme from localStorage', () => {
    window.localStorage.setItem(KEY, 'light');
    render(<ThemeToggle storageKey={KEY} />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('honors defaultTheme override when nothing is stored', () => {
    render(<ThemeToggle storageKey={KEY} defaultTheme="light" />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('does not persist when storageKey is null', () => {
    render(<ThemeToggle storageKey={null} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    // Whatever was stored before should be untouched (empty here)
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('fires onChange whenever the theme updates', () => {
    const onChange = vi.fn();
    render(<ThemeToggle storageKey={KEY} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('writes to a custom target element when provided', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    render(<ThemeToggle storageKey={KEY} target={target} />);
    expect(target.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button'));
    expect(target.getAttribute('data-theme')).toBe('light');
    target.remove();
  });
});
