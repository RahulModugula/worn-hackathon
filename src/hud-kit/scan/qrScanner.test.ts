import encodeQR from 'qr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaFrame } from '../platform/types';
import { createQrScanner, cropCenter, SCAN_INTERVAL_MS, SCAN_TIMEOUT_MS } from './qrScanner';

const W = 1280;
const H = 720;
const MODULE_PX = 10;
// The raw matrix already carries 2 blank modules per side; this adds 2 more so the code has a 4-module quiet zone.
const EXTRA_QUIET_MODULES = 2;

function blankFrame(): RgbaFrame {
  return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
}

/** Draws a QR code as RGBA with its top-left corner at (x, y). Returns the frame. */
function renderQr(text: string, x: number, y: number): RgbaFrame {
  const matrix = encodeQR(text, 'raw') as boolean[][];
  const frame = blankFrame();
  const origin = { x: x + EXTRA_QUIET_MODULES * MODULE_PX, y: y + EXTRA_QUIET_MODULES * MODULE_PX };
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      for (let dy = 0; dy < MODULE_PX; dy++) {
        for (let dx = 0; dx < MODULE_PX; dx++) {
          const px = origin.x + c * MODULE_PX + dx;
          const py = origin.y + r * MODULE_PX + dy;
          const i = (py * W + px) * 4;
          frame.data[i] = 0;
          frame.data[i + 1] = 0;
          frame.data[i + 2] = 0;
        }
      }
    }
  }
  return frame;
}

const QR_SIZE = (25 + EXTRA_QUIET_MODULES * 2) * MODULE_PX; // 290 px
const CENTERED = { x: Math.floor((W - QR_SIZE) / 2), y: Math.floor((H - QR_SIZE) / 2) };

function fakeCamera() {
  const subs = new Set<(f: RgbaFrame) => void>();
  return {
    camera: {
      onFrame(cb: (f: RgbaFrame) => void) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    },
    emit(frame: RgbaFrame) {
      for (const cb of [...subs]) cb(frame);
    },
    subscribers: () => subs.size,
  };
}

/** One camera tick: deliver a frame at the current time, then advance one scan interval. */
function step(cam: ReturnType<typeof fakeCamera>, frame: RgbaFrame = blankFrame()) {
  cam.emit(frame);
  vi.advanceTimersByTime(SCAN_INTERVAL_MS);
}

/** Scripted decoder: result i is returned on the i-th decode call, null afterwards. */
function scripted(results: Array<string | null>) {
  let i = 0;
  const calls = { count: 0 };
  return {
    calls,
    decode: () => {
      calls.count++;
      return results[i++] ?? null;
    },
  };
}

describe('qrScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  });

  it('decodes a centered QR after three matching reads (real decoder)', () => {
    const cam = fakeCamera();
    const onFirstRead = vi.fn();
    const onLock = vi.fn();
    const scanner = createQrScanner({ camera: cam.camera, onFirstRead, onLock });
    scanner.enable();
    const centered = renderQr('HELLO-123', CENTERED.x, CENTERED.y);

    step(cam, centered);
    expect(onFirstRead).toHaveBeenCalledTimes(1);
    expect(onLock).not.toHaveBeenCalled();
    step(cam, centered);
    expect(onLock).not.toHaveBeenCalled();
    step(cam, centered);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onLock).toHaveBeenCalledWith('HELLO-123');
    expect(scanner.enabled).toBe(false);
    expect(cam.subscribers()).toBe(0);
  });

  it('never decodes a code that sits only in the outer margin (AC#4)', () => {
    const cam = fakeCamera();
    const onFirstRead = vi.fn();
    const onLock = vi.fn();
    const onTimeout = vi.fn();
    const scanner = createQrScanner({ camera: cam.camera, onFirstRead, onLock, onTimeout });
    scanner.enable();
    const margin = renderQr('HELLO-123', 0, 0); // entirely left of the 400 px crop edge

    for (let i = 0; i < 24; i++) step(cam, margin); // 6 s of frames
    expect(onFirstRead).not.toHaveBeenCalled();
    expect(onLock).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('dwell window restarts when a matching read arrives after 1.2 s', () => {
    const cam = fakeCamera();
    const onLock = vi.fn();
    // reads at 0, 250 (count 2); misses; read at 1250 is outside the window (reset to 1); 1500 -> 2; 1750 -> 3
    const s = scripted(['A', 'A', null, null, null, 'A', 'A', 'A']);
    const scanner = createQrScanner({ camera: cam.camera, onLock, decode: s.decode });
    scanner.enable();
    for (let i = 0; i < 7; i++) step(cam);
    expect(onLock).not.toHaveBeenCalled();
    step(cam);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onLock).toHaveBeenCalledWith('A');
  });

  it('a different payload restarts the dwell', () => {
    const cam = fakeCamera();
    const onLock = vi.fn();
    const s = scripted(['A', 'B', 'A', 'B', 'A', 'B']);
    const scanner = createQrScanner({ camera: cam.camera, onLock, decode: s.decode });
    scanner.enable();
    for (let i = 0; i < 6; i++) step(cam);
    expect(onLock).not.toHaveBeenCalled();
    expect(scanner.enabled).toBe(true);
  });

  it('times out 5 s after the first read and disables itself', () => {
    const cam = fakeCamera();
    const onTimeout = vi.fn();
    const onLock = vi.fn();
    const s = scripted(['A']);
    const scanner = createQrScanner({ camera: cam.camera, onLock, onTimeout, decode: s.decode });
    scanner.enable();
    step(cam); // first read at t=0
    expect(onTimeout).not.toHaveBeenCalled();
    for (let i = 0; i < 18; i++) step(cam); // now at 4750 ms
    expect(onTimeout).not.toHaveBeenCalled();
    step(cam); // reaches 5000 ms
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onLock).not.toHaveBeenCalled();
    expect(scanner.enabled).toBe(false);
    const callsAfter = s.calls.count;
    cam.emit(blankFrame());
    vi.advanceTimersByTime(SCAN_TIMEOUT_MS);
    expect(s.calls.count).toBe(callsAfter);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('disable() cancels a pending session and its timeout', () => {
    const cam = fakeCamera();
    const onTimeout = vi.fn();
    const onLock = vi.fn();
    const s = scripted(['A']);
    const scanner = createQrScanner({ camera: cam.camera, onLock, onTimeout, decode: s.decode });
    scanner.enable();
    step(cam);
    scanner.disable();
    vi.advanceTimersByTime(SCAN_TIMEOUT_MS * 2);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onLock).not.toHaveBeenCalled();
  });

  it('tolerates a camera without onFrame and a malformed frame', () => {
    const decode = vi.fn(() => null);
    const scanner = createQrScanner({ camera: {}, onLock: () => {}, decode });
    expect(() => {
      scanner.enable();
      scanner.disable();
    }).not.toThrow();

    const cam = fakeCamera();
    const scanner2 = createQrScanner({ camera: cam.camera, onLock: () => {}, decode });
    scanner2.enable();
    expect(() => cam.emit({ width: W, height: H, data: new Uint8ClampedArray(10) })).not.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });

  it('uses native BarcodeDetector when the browser provides it', async () => {
    const detect = vi.fn(async () => [{ rawValue: 'NATIVE' }]);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect = detect;
    };
    const cam = fakeCamera();
    const onLock = vi.fn();
    const scanner = createQrScanner({ camera: cam.camera, onLock });
    scanner.enable();
    for (let i = 0; i < 3; i++) {
      cam.emit(blankFrame());
      await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    }
    expect(detect).toHaveBeenCalled();
    expect(onLock).toHaveBeenCalledWith('NATIVE');
  });

  it('a throwing decoder counts as a miss', () => {
    const cam = fakeCamera();
    const onFirstRead = vi.fn();
    const scanner = createQrScanner({
      camera: cam.camera,
      onLock: () => {},
      onFirstRead,
      decode: () => {
        throw new Error('boom');
      },
    });
    scanner.enable();
    expect(() => step(cam)).not.toThrow();
    expect(onFirstRead).not.toHaveBeenCalled();
  });
});

describe('cropCenter', () => {
  it('returns the centre 480x480 of a 1280x720 frame', () => {
    const frame = blankFrame();
    const at = (400 + 120 * W) * 4; // top-left of the crop
    frame.data.set([1, 2, 3, 255], at);
    const crop = cropCenter(frame);
    expect(crop?.width).toBe(480);
    expect(crop?.height).toBe(480);
    expect(Array.from(crop!.data.slice(0, 4))).toEqual([1, 2, 3, 255]);
  });

  it('clamps to small frames and rejects malformed buffers', () => {
    const small = { width: 100, height: 50, data: new Uint8ClampedArray(100 * 50 * 4) };
    expect(cropCenter(small)?.width).toBe(100);
    expect(cropCenter(small)?.height).toBe(50);
    expect(cropCenter({ width: 100, height: 50, data: new Uint8ClampedArray(4) })).toBeNull();
  });
});
