import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { PreviewFrame } from './PreviewFrame';

describe('PreviewFrame', () => {
  it('mirror mode renders only the children, with no desktop controls', () => {
    const { container } = render(<PreviewFrame mirror zoom={1} theme="green" onZoomChange={() => {}} onThemeChange={() => {}}><i data-testid="kid" /></PreviewFrame>);
    expect(screen.getByTestId('kid')).toBeTruthy();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[data-hud="mirror"]')).not.toBeNull();
  });

  it('the zoom button toggles between 1x and 2x and reflects the state', () => {
    const onZoom = vi.fn();
    const { container, rerender } = render(<PreviewFrame mirror={false} zoom={1} theme="green" onZoomChange={onZoom} onThemeChange={() => {}} />);
    expect(container.querySelector('.hud-preview__frame--2x')).toBeNull();
    fireEvent.click(screen.getByText('Preview 2x'));
    expect(onZoom).toHaveBeenLastCalledWith(2);
    rerender(<PreviewFrame mirror={false} zoom={2} theme="green" onZoomChange={onZoom} onThemeChange={() => {}} />);
    expect(container.querySelector('.hud-preview__frame--2x')).not.toBeNull();
    expect(screen.getByText('Preview 2x').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('Preview 2x'));
    expect(onZoom).toHaveBeenLastCalledWith(1);
  });

  it('the theme button flips green and color both ways', () => {
    const onTheme = vi.fn();
    const { rerender } = render(<PreviewFrame mirror={false} zoom={1} theme="green" onZoomChange={() => {}} onThemeChange={onTheme} />);
    fireEvent.click(screen.getByText(/Theme: green/));
    expect(onTheme).toHaveBeenLastCalledWith('color');
    rerender(<PreviewFrame mirror={false} zoom={1} theme="color" onZoomChange={() => {}} onThemeChange={onTheme} />);
    fireEvent.click(screen.getByText(/Theme: color/));
    expect(onTheme).toHaveBeenLastCalledWith('green');
  });
});
