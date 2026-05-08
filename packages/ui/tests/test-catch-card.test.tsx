import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { CatchCard } from '../src/components/CatchCard.js';

describe('CatchCard', () => {
  const baseProps = {
    code: 'SQL-005',
    title: 'NULL comparison footgun',
    severity: 'warn' as const,
    confidence: 95,
    detail: 'WHERE col = NULL never matches; use IS NULL.',
    fix: 'Replace `= NULL` with `IS NULL`.',
    threatCategories: ['corruption'],
  };

  it('renders code, title, detail, fix', () => {
    render(<CatchCard {...baseProps} />);
    expect(screen.getByText('SQL-005')).toBeInTheDocument();
    expect(screen.getByText('NULL comparison footgun')).toBeInTheDocument();
    expect(screen.getByText(/never matches/)).toBeInTheDocument();
    // 'IS NULL' appears in both detail + fix; assert at least one match.
    expect(screen.getAllByText(/IS NULL/).length).toBeGreaterThan(0);
  });

  it('renders severity badge with confidence', () => {
    render(<CatchCard {...baseProps} />);
    expect(screen.getByText('warn')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });

  it('renders threat categories as tags', () => {
    render(<CatchCard {...baseProps} threatCategories={['destruction', 'corruption']} />);
    expect(screen.getByText('destruction')).toBeInTheDocument();
    expect(screen.getByText('corruption')).toBeInTheDocument();
  });

  it('omits the fix block when fix is undefined', () => {
    const { container } = render(
      <CatchCard
        code={baseProps.code}
        title={baseProps.title}
        severity={baseProps.severity}
        detail={baseProps.detail}
      />,
    );
    expect(container.querySelector('.vg-catch-card__fix')).toBeNull();
  });

  it('renders location when provided', () => {
    render(<CatchCard {...baseProps} location="line 21:12" />);
    expect(screen.getByText('line 21:12')).toBeInTheDocument();
  });

  it('applies severity-specific class to the root', () => {
    const { container } = render(<CatchCard {...baseProps} severity="block" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('vg-catch-card--block');
  });

  it('is non-interactive by default (no role=button)', () => {
    render(<CatchCard {...baseProps} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes a button when onActivate is provided', () => {
    const onActivate = vi.fn();
    render(<CatchCard {...baseProps} onActivate={onActivate} />);
    const card = screen.getByRole('button');
    fireEvent.click(card);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('activates on Enter and Space when interactive', () => {
    const onActivate = vi.fn();
    render(<CatchCard {...baseProps} onActivate={onActivate} />);
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
