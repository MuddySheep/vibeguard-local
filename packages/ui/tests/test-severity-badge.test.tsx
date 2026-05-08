import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SeverityBadge } from '../src/components/SeverityBadge.js';

describe('SeverityBadge', () => {
  it('renders the default label for each severity', () => {
    for (const sev of ['block', 'warn', 'info', 'allow'] as const) {
      const { unmount } = render(<SeverityBadge severity={sev} />);
      expect(screen.getByText(sev)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies a severity-specific class', () => {
    const { container } = render(<SeverityBadge severity="block" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('vg-severity-badge--block');
  });

  it('renders confidence when provided', () => {
    render(<SeverityBadge severity="warn" confidence={85} />);
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('omits confidence when not provided', () => {
    const { container } = render(<SeverityBadge severity="info" />);
    expect(container.querySelector('.vg-severity-badge__confidence')).toBeNull();
  });

  it('honors custom label override', () => {
    render(<SeverityBadge severity="block" label="critical" />);
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('exposes an accessible status role with severity in aria-label', () => {
    render(<SeverityBadge severity="warn" confidence={90} />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-label')).toMatch(/warn/i);
    expect(el.getAttribute('aria-label')).toMatch(/90/);
  });
});
