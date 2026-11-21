import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCamera, createBrowserInput, createBrowserMic } from './browser';

// A fake camera stack: navigator.mediaDevices, a video element and a canvas context.
function stubCamera(opts: { readyState?: number; ctx2d?: boolean; drawThrows?: boolean; playRejects?: boolean } = {}) {
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const video = { muted: false, playsInline: false, srcObject: null as unknown, readyState: opts.readyState ?? 4, play: () => (opts.playRejects ? Promise.reject(new Error('autoplay')) : Promise.resolve()) };
  const ctx = {
    drawImage: () => { if (opts.drawThrows) throw new Error('draw'); },
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  const canvas = { width: 0, height: 0, getContext: () => (opts.ctx2d === false ? null : ctx) };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal('document', { createElement: (t: string) => (t === 'video' ? video : canvas) });
  return { track, video };
}

describe('browser camera pump', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('emits 1280x720 frames at 4 FPS to subscribers, and none after unsubscribe', async () => {
    stubCamera();
    const cam = createBrowserCamera();
    const cb = vi.fn();
    const off = cam.onFrame(cb);
    expect(await cam.start()).toEqual({ available: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(4);
    expect(cb.mock.calls[0][0]).toMatchObject({ width: 1280, height: 720 });
    off();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(4);
    cam.stop();
  });

  it('start() is idempotent while running; stop() ends the tracks and the pump', async () => {
    const { track } = stubCamera();
    const cam = createBrowserCamera();
    const cb = vi.fn();
    cam.onFrame(cb);
    await cam.start();
    expect(await cam.start()).toEqual({ available: true });
    cam.stop();
    expect(track.stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('pause stops frames and disables tracks; resume restarts both', async () => {
    const { track } = stubCamera();
    const cam = createBrowserCamera();
    const cb = vi.fn();
    cam.onFrame(cb);
    await cam.start();
    cam.pause!();
    expect(track.enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).not.toHaveBeenCalled();
    cam.resume!();
    expect(track.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalled();
    cam.stop();
  });

  it('resume before start is a no-op', () => {
    const cam = createBrowserCamera();
    expect(() => cam.resume!()).not.toThrow();
  });

  it('skips frames until the video has data, and survives a draw error', async () => {
    stubCamera({ readyState: 0 });
    const cam = createBrowserCamera();
    const cb = vi.fn();
    cam.onFrame(cb);
    await cam.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).not.toHaveBeenCalled();
    cam.stop();

    stubCamera({ drawThrows: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cam2 = createBrowserCamera();
    cam2.onFrame(cb);
    await cam2.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(cb).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    cam2.stop();
  });

  it('a throwing subscriber does not starve the others', async () => {
    stubCamera();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cam = createBrowserCamera();
    const good = vi.fn();
    cam.onFrame(() => { throw new Error('boom'); });
    cam.onFrame(good);
    await cam.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(good).toHaveBeenCalled();
    err.mockRestore();
    cam.stop();
  });

  it('reports unavailable and releases the stream when there is no 2d context; tolerates autoplay refusal', async () => {
    const { track } = stubCamera({ ctx2d: false });
    const res = await createBrowserCamera().start();
    expect(res.available).toBe(false);
    expect(track.stopped).toBe(true);

    stubCamera({ playRejects: true });
    expect(await createBrowserCamera().start()).toEqual({ available: true });
  });

  it('mic probe stops its tracks right away when permission is granted', async () => {
    const { track } = stubCamera();
    expect(await createBrowserMic().start()).toEqual({ available: true });
    expect(track.stopped).toBe(true);
  });
});

describe('browser input keys', () => {
  it('Space and Enter tap, Escape long-presses, repeats and typing in fields are ignored, unsubscribe works', () => {
    const input = createBrowserInput();
    const tap = vi.fn();
    const long = vi.fn();
    const offTap = input.onTap(tap);
    const offLong = input.onLongPress(long);
    const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    press(' '); press('Enter'); press('Escape');
    expect(tap).toHaveBeenCalledTimes(2);
    expect(long).toHaveBeenCalledTimes(1);
    press(' ', { repeat: true });
    expect(tap).toHaveBeenCalledTimes(2);
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      press(' ', {}, el);
      el.remove();
    }
    expect(tap).toHaveBeenCalledTimes(2);
    offTap(); offLong();
    press(' '); press('Escape');
    expect(tap).toHaveBeenCalledTimes(2);
    expect(long).toHaveBeenCalledTimes(1);
  });
});
