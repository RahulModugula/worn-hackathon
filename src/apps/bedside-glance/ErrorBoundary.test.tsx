import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);
function Boom(): never { throw new Error('boom'); }

describe('ErrorBoundary', () => {
  it('shows a calm Reconnecting fallback and logs instead of a blank page', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ErrorBoundary retryMs={0}><Boom /></ErrorBoundary>);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    expect(log.mock.calls.some((c) => String(c[0]).includes('bedside-glance render error'))).toBe(true);
    log.mockRestore();
  });
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary retryMs={0}><p>fine</p></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
