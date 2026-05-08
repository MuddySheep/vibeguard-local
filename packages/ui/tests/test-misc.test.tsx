import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Mesh } from '../src/components/Mesh.js';
import { Grain } from '../src/components/Grain.js';
import { Reveal } from '../src/components/Reveal.js';
import { CodeBlock } from '../src/components/CodeBlock.js';
import { Nav, NavCta } from '../src/components/Nav.js';

describe('Mesh', () => {
  it('renders with the expected className', () => {
    const { container } = render(<Mesh />);
    expect(container.firstElementChild?.className).toContain('vg-mesh');
  });

  it('appends user className', () => {
    const { container } = render(<Mesh className="extra" />);
    expect(container.firstElementChild?.className).toContain('extra');
  });
});

describe('Grain', () => {
  it('renders with the expected className', () => {
    const { container } = render(<Grain />);
    expect(container.firstElementChild?.className).toContain('vg-grain');
  });

  it('honors opacity override', () => {
    const { container } = render(<Grain opacity={0.2} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.opacity).toBe('0.2');
  });
});

describe('Reveal', () => {
  // Track the latest IntersectionObserver instance
  let lastInstance: { trigger?: () => void; el?: HTMLElement } = {};

  beforeEach(() => {
    lastInstance = {};
    class FakeIO {
      private cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
      private el: HTMLElement | undefined;
      constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
        this.cb = cb;
      }
      observe(el: HTMLElement) {
        this.el = el;
        lastInstance.el = el;
        lastInstance.trigger = () =>
          this.cb([{ isIntersecting: true, target: el }]);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root: Element | null = null;
      rootMargin = '';
      thresholds: ReadonlyArray<number> = [];
    }
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts hidden and gains .in class once visible', () => {
    const { container } = render(<Reveal>hello</Reveal>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('vg-reveal');
    expect(el.className).not.toMatch(/\bin\b/);
    lastInstance.trigger!();
    expect(el.className).toMatch(/\bin\b/);
  });

  it('applies transition-delay when delay prop is set', () => {
    const { container } = render(<Reveal delay={120}>x</Reveal>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.transitionDelay).toBe('120ms');
  });
});

describe('CodeBlock', () => {
  it('renders code text verbatim', () => {
    render(<CodeBlock code={'SELECT 1\nFROM dual'} />);
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument();
  });

  it('renders language header when provided', () => {
    render(<CodeBlock code="SELECT 1" language="sql" />);
    expect(screen.getByText('sql')).toBeInTheDocument();
  });

  it('omits language header when not provided', () => {
    const { container } = render(<CodeBlock code="SELECT 1" />);
    expect(container.querySelector('.vg-code-block__head')).toBeNull();
  });
});

describe('Nav', () => {
  it('renders brand + actions', () => {
    render(
      <Nav brand="VibeGuard">
        <NavCta href="/x">Docs</NavCta>
      </Nav>,
    );
    expect(screen.getByText('VibeGuard')).toBeInTheDocument();
    expect(screen.getByText('Docs')).toBeInTheDocument();
  });
});

describe('NavCta', () => {
  it('renders an anchor when href is provided', () => {
    render(<NavCta href="/x">Hi</NavCta>);
    expect(screen.getByRole('link', { name: 'Hi' })).toHaveAttribute('href', '/x');
  });

  it('opens externally when external=true', () => {
    render(<NavCta href="https://example.com" external>Hi</NavCta>);
    const a = screen.getByRole('link', { name: 'Hi' });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('renders a button when no href is provided', () => {
    const onClick = vi.fn();
    render(<NavCta onClick={onClick}>Hi</NavCta>);
    fireEvent.click(screen.getByRole('button', { name: 'Hi' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies variant-specific class', () => {
    const { container } = render(<NavCta variant="ghost">x</NavCta>);
    expect(container.firstElementChild?.className).toContain('vg-nav-cta--ghost');
  });
});
