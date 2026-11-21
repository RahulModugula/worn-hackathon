import { describe, expect, it } from 'vitest';
import { getInstanceId } from './useSession';

describe('getInstanceId', () => {
  it('is uuid-shaped and stable for this tab', () => {
    const a = getInstanceId();
    expect(a).toMatch(/^[0-9a-f-]{8,64}$/);
    expect(getInstanceId()).toBe(a);
  });
  it('a corrupt stored value is replaced, not sent to the server', () => {
    sessionStorage.setItem('hud-instance', '<bad value>');
    expect(getInstanceId()).toMatch(/^[0-9a-f-]{8,64}$/);
  });
  it('still works when sessionStorage throws', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')!;
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      const a = getInstanceId();
      expect(a).toMatch(/^[0-9a-f-]{8,64}$/);
      expect(getInstanceId()).toBe(a);
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', real);
    }
  });
});
