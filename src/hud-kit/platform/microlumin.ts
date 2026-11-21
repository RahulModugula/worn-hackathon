import type { AvailabilityResult, PlatformAdapter, RgbaFrame, Transcript } from './types';

/**
 * Surface the M6 host injects as `window.__M6_BRIDGE__`.
 * STUB: every member is optional until BG-08 wires the real bridge contract from the SDK docs.
 */
export interface M6Bridge {
  onFrame?(cb: (frame: RgbaFrame) => void): void;
  onTranscript?(cb: (transcript: Transcript) => void): void;
  onTap?(cb: () => void): void;
  onLongPress?(cb: () => void): void;
  pushCanvasBitmap?(bitmap: ImageBitmap | RgbaFrame): void;
  /** Android wrapper: JSON string of device facts; `battery` (0-100) is optional and absent on older APKs. */
  getInfo?(): string;
}

/** Returns the injected bridge, or null when running outside the glasses. */
export function getM6Bridge(scope: object = globalThis): M6Bridge | null {
  const bridge = (scope as { __M6_BRIDGE__?: unknown }).__M6_BRIDGE__;
  return bridge && typeof bridge === 'object' ? (bridge as M6Bridge) : null;
}

/** Battery percent from the wrapper bridge's getInfo, or null when unavailable. Never throws. */
export function readBridgeBattery(scope: object = globalThis): number | null {
  try {
    const raw = getM6Bridge(scope)?.getInfo?.();
    if (typeof raw !== 'string') return null;
    const level = (JSON.parse(raw) as { battery?: unknown }).battery;
    return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 100 ? level : null;
  } catch {
    return null;
  }
}

function fanout<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const cb of listeners) {
    try {
      cb(value);
    } catch (err) {
      console.error('microlumin listener failed', err);
    }
  }
}

/**
 * Adapter over the M6 bridge. Each bridge event is fanned out to subscribers here, so
 * subscribers never talk to the bridge directly. Stub: BG-08 replaces the TODOs.
 */
export function createMicroLuminPlatform(bridge: M6Bridge): PlatformAdapter {
  const frameListeners = new Set<(frame: RgbaFrame) => void>();
  const transcriptListeners = new Set<(transcript: Transcript) => void>();
  const tapListeners = new Set<() => void>();
  const longPressListeners = new Set<() => void>();

  // TODO(BG-08): confirm each bridge method signature against the SDK docs before relying on it.
  bridge.onFrame?.((frame) => fanout(frameListeners, frame));
  bridge.onTranscript?.((transcript) => fanout(transcriptListeners, transcript));
  bridge.onTap?.(() => fanout(tapListeners, undefined));
  bridge.onLongPress?.(() => fanout(longPressListeners, undefined));

  function subscribe<T>(set: Set<T>, cb: T): () => void {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  return {
    name: 'microlumin',
    camera: {
      // TODO(BG-08): start the glasses camera through the bridge; stub reports availability only.
      async start(): Promise<AvailabilityResult> {
        return typeof bridge.onFrame === 'function'
          ? { available: true }
          : { available: false, reason: 'bridge-no-frames' };
      },
      stop() {},
      onFrame: (cb) => subscribe(frameListeners, cb),
    },
    mic: {
      // TODO(BG-08): start the glasses mic through the bridge; stub reports availability only.
      async start(): Promise<AvailabilityResult> {
        return typeof bridge.onTranscript === 'function'
          ? { available: true }
          : { available: false, reason: 'bridge-no-transcripts' };
      },
      stop() {},
      onTranscript: (cb) => subscribe(transcriptListeners, cb),
    },
    input: {
      onTap: (cb) => subscribe(tapListeners, cb),
      onLongPress: (cb) => subscribe(longPressListeners, cb),
    },
    display: {
      pushCanvasBitmap(bitmap) {
        try {
          bridge.pushCanvasBitmap?.(bitmap);
        } catch (err) {
          console.error('pushCanvasBitmap failed', err);
        }
      },
    },
  };
}
