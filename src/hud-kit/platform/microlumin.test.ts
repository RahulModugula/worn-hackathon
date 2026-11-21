import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RgbaFrame } from './types';
import { createMicroLuminPlatform, getM6Bridge, readBridgeBattery, type M6Bridge } from './microlumin';

const frame: RgbaFrame = { width: 1, height: 1, data: new Uint8ClampedArray(4) };

function fakeBridge() {
  const handlers: {
    frame?: (f: RgbaFrame) => void;
    transcript?: (t: { text: string; final: boolean }) => void;
    tap?: () => void;
    longPress?: () => void;
  } = {};
  const pushed: unknown[] = [];
  const bridge: M6Bridge = {
    onFrame: (cb) => {
      handlers.frame = cb;
    },
    onTranscript: (cb) => {
      handlers.transcript = cb;
    },
    onTap: (cb) => {
      handlers.tap = cb;
    },
    onLongPress: (cb) => {
      handlers.longPress = cb;
    },
    pushCanvasBitmap: (b) => {
      pushed.push(b);
    },
  };
  return { bridge, handlers, pushed };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('microlumin platform', () => {
  it('getM6Bridge returns null outside the glasses and the bridge when injected', () => {
    expect(getM6Bridge({})).toBeNull();
    const { bridge } = fakeBridge();
    expect(getM6Bridge({ __M6_BRIDGE__: bridge })).toBe(bridge);
  });

  it('fans bridge events out to subscribers and forwards pushCanvasBitmap', () => {
    const { bridge, handlers, pushed } = fakeBridge();
    const platform = createMicroLuminPlatform(bridge);
    expect(platform.name).toBe('microlumin');

    const onFrame = vi.fn();
    const onTranscript = vi.fn();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    platform.camera.onFrame(onFrame);
    platform.mic.onTranscript(onTranscript);
    platform.input.onTap(onTap);
    platform.input.onLongPress(onLongPress);

    handlers.frame?.(frame);
    handlers.transcript?.({ text: 'alpha', final: true });
    handlers.tap?.();
    handlers.longPress?.();
    expect(onFrame).toHaveBeenCalledWith(frame);
    expect(onTranscript).toHaveBeenCalledWith({ text: 'alpha', final: true });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    platform.display?.pushCanvasBitmap?.(frame);
    expect(pushed).toEqual([frame]);
  });

  it('one throwing subscriber does not block the others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bridge, handlers } = fakeBridge();
    const platform = createMicroLuminPlatform(bridge);
    const good = vi.fn();
    platform.input.onTap(() => {
      throw new Error('listener bug');
    });
    platform.input.onTap(good);
    expect(() => handlers.tap?.()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports unavailable when the bridge lacks the hook (stub behaviour)', async () => {
    const platform = createMicroLuminPlatform({});
    await expect(platform.camera.start()).resolves.toEqual({ available: false, reason: 'bridge-no-frames' });
    await expect(platform.mic.start()).resolves.toEqual({ available: false, reason: 'bridge-no-transcripts' });
  });
});

describe('readBridgeBattery', () => {
  it('reads a numeric battery level from getInfo JSON', () => {
    expect(readBridgeBattery({ __M6_BRIDGE__: { getInfo: () => JSON.stringify({ battery: 83 }) } })).toBe(83);
  });
  it('is null when there is no bridge, no getInfo, bad JSON, a throw or an out-of-range value', () => {
    expect(readBridgeBattery({})).toBeNull();
    expect(readBridgeBattery({ __M6_BRIDGE__: {} })).toBeNull();
    expect(readBridgeBattery({ __M6_BRIDGE__: { getInfo: () => 'not json' } })).toBeNull();
    expect(readBridgeBattery({ __M6_BRIDGE__: { getInfo: () => { throw new Error('x'); } } })).toBeNull();
    expect(readBridgeBattery({ __M6_BRIDGE__: { getInfo: () => '{"battery":-1}' } })).toBeNull();
    expect(readBridgeBattery({ __M6_BRIDGE__: { getInfo: () => '{"battery":"high"}' } })).toBeNull();
    expect(readBridgeBattery({ __M6_BRIDGE__: { getInfo: () => '{}' } })).toBeNull();
  });
});
