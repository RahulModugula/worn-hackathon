import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCamera, createBrowserMic, createBrowserPlatform } from './browser';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser platform', () => {
  it('reports unsupported instead of throwing when there is no mediaDevices (plain node)', async () => {
    await expect(createBrowserCamera().start()).resolves.toEqual({ available: false, reason: 'unsupported' });
    await expect(createBrowserMic().start()).resolves.toEqual({ available: false, reason: 'unsupported' });
  });

  it('resolves available:false with the error name when camera permission is denied', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        },
      },
    });
    vi.stubGlobal('document', {});
    await expect(createBrowserCamera().start()).resolves.toEqual({ available: false, reason: 'NotAllowedError' });
  });

  it('mic probe reports denial without throwing', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        },
      },
    });
    await expect(createBrowserMic().start()).resolves.toEqual({ available: false, reason: 'NotAllowedError' });
  });

  it('exposes the browser platform name, and input is a no-op without a window', () => {
    const platform = createBrowserPlatform();
    expect(platform.name).toBe('browser');
    const unsub = platform.input.onTap(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('frame subscriptions can be removed', () => {
    const camera = createBrowserCamera();
    const cb = vi.fn();
    const unsub = camera.onFrame(cb);
    unsub();
    camera.stop();
    expect(cb).not.toHaveBeenCalled();
  });
});
