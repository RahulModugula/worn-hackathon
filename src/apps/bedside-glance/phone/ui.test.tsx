import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState, Sheet, Skeleton, Stat, UndoRing } from './ui';

afterEach(cleanup);

describe('Sheet (modal dialog)', () => {
  it('moves focus into the dialog, closes on Escape and scrim click but not on inner click, and restores focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { container, unmount } = render(
      <Sheet title="Dose" titleId="t" onClose={onClose}><button>One</button><button>Two</button></Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute('aria-labelledby')).toBe('t');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.ph-scrim')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab and Shift+Tab inside the dialog by wrapping at both ends', () => {
    render(<Sheet title="Dose" titleId="t" onClose={() => {}}><button>One</button><button>Two</button></Sheet>);
    const dialog = screen.getByRole('dialog');
    const els = [...dialog.querySelectorAll<HTMLElement>('button')]; // Close, One, Two
    const last = els[els.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(els[0]);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // From the middle, Tab is left to the browser.
    els[1].focus();
    const mid = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(mid);
    expect(mid.defaultPrevented).toBe(false);
  });

  it('hideClose removes the Close button; other keys do nothing', () => {
    const onClose = vi.fn();
    render(<Sheet title="Dose" titleId="t" onClose={onClose} hideClose><span>body</span></Sheet>);
    expect(screen.queryByText('Close')).toBeNull();
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('small display parts', () => {
  it('UndoRing drains in proportion to the remaining window and clamps out-of-range values', () => {
    const offset = (ms: number) => {
      const { container, unmount } = render(<UndoRing remainingMs={ms} secondsLeft={3} />);
      const arc = container.querySelector('.ph-ring-arc')!;
      const v = [Number(arc.getAttribute('stroke-dasharray')), Number(arc.getAttribute('stroke-dashoffset'))];
      unmount();
      return v[1] / v[0];
    };
    expect(offset(10_000)).toBeCloseTo(0);
    expect(offset(5_000)).toBeCloseTo(0.5);
    expect(offset(0)).toBeCloseTo(1);
    expect(offset(-500)).toBeCloseTo(1);
    expect(offset(99_000)).toBeCloseTo(0);
  });
  it('Stat renders the sub line only when given; EmptyState renders body and action only when given; Skeleton is hidden from AT', () => {
    const { rerender, container } = render(<dl><Stat label="L" value="V" /></dl>);
    expect(container.querySelector('.ph-stat-sub')).toBeNull();
    rerender(<dl><Stat label="L" value="V" sub="S" /></dl>);
    expect(container.querySelector('.ph-stat-sub')?.textContent).toBe('S');
    rerender(<EmptyState icon="alert" title="Nothing" />);
    expect(container.querySelector('.ph-empty-body')).toBeNull();
    rerender(<EmptyState icon="alert" title="Nothing" action={<button>Go</button>}>Details</EmptyState>);
    expect(container.querySelector('.ph-empty-body')?.textContent).toBe('Details');
    expect(screen.getByText('Go')).toBeTruthy();
    rerender(<Skeleton height={8} width="50%" />);
    expect(container.querySelector('.ph-skel')?.getAttribute('aria-hidden')).toBe('true');
  });
});
