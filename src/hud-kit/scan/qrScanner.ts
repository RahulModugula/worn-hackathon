import decodeQR from 'qr/decode.js';
import type { RgbaFrame } from '../platform/types';

/** 4 FPS. */
export const SCAN_INTERVAL_MS = 250;
/** Center crop of the 1280x720 frame: wristbands at the edge of view never decode. */
export const CROP_SIZE = 480;
/** Three matching reads inside the window lock the code. */
export const DWELL_READS = 3;
export const DWELL_WINDOW_MS = 1200;
/** Counted from the first valid read (G1 to G2) until lock or timeout. */
export const SCAN_TIMEOUT_MS = 5000;

/** Returns the decoded payload, or null for a miss. Async when a native BarcodeDetector is used. */
export type DecodeFn = (frame: RgbaFrame) => string | null | Promise<string | null>;

export interface QrScannerOptions {
  camera: { onFrame?(cb: (frame: RgbaFrame) => void): () => void };
  /** Fires once per scan session, on the first valid read. */
  onFirstRead?: () => void;
  /** Fires when the dwell is satisfied. The scanner disables itself. */
  onLock: (payload: string) => void;
  /** Fires when no lock happens within SCAN_TIMEOUT_MS of the first read. The scanner disables itself. */
  onTimeout?: () => void;
  /** Test seam. Defaults to native BarcodeDetector when present, else the qr package decoder. */
  decode?: DecodeFn;
}

export interface QrScanner {
  enable(): void;
  disable(): void;
  readonly enabled: boolean;
}

/** Center crop of a frame, clamped to the frame size. Returns null when the buffer is malformed. */
export function cropCenter(frame: RgbaFrame, size: number = CROP_SIZE): RgbaFrame | null {
  const { width, height, data } = frame;
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  const w = Math.min(size, width);
  const h = Math.min(size, height);
  const x0 = Math.floor((width - w) / 2);
  const y0 = Math.floor((height - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const start = ((y0 + y) * width + x0) * 4;
    out.set(data.subarray(start, start + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

interface NativeDetector {
  detect(source: unknown): Promise<Array<{ rawValue: string }>>;
}
type NativeDetectorCtor = new (options: { formats: string[] }) => NativeDetector;

function makeDefaultDecoder(): DecodeFn {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  let detector: NativeDetector | null = null;
  if (typeof Native === 'function') {
    try {
      detector = new Native({ formats: ['qr_code'] });
    } catch {
      detector = null; // unsupported on this runtime: use the pure-JS decoder
    }
  }
  if (detector) {
    const native = detector;
    return async (frame) => {
      try {
        const source =
          typeof ImageData !== 'undefined' ? new ImageData(frame.data as never, frame.width, frame.height) : frame;
        const found = await native.detect(source);
        return found[0]?.rawValue || null;
      } catch {
        return null;
      }
    };
  }
  // decodeQR throws when the frame holds no code: that is a miss, not an error.
  return (frame) => {
    try {
      return decodeQR({ width: frame.width, height: frame.height, data: frame.data }, { format: 'RGBA' }) || null;
    } catch {
      return null;
    }
  };
}

/**
 * QR scanner over camera frames. Reads the centre 480x480 crop at 4 FPS and locks a payload after
 * DWELL_READS matching reads within DWELL_WINDOW_MS. Lock and timeout both disable the scanner;
 * the app re-enables it when it returns to the scanning state.
 */
export function createQrScanner(options: QrScannerOptions): QrScanner {
  const decode = options.decode ?? makeDefaultDecoder();
  let enabled = false;
  let unsubscribe: (() => void) | null = null;
  let lastTick = Number.NEGATIVE_INFINITY;
  let busy = false;
  let generation = 0; // bumps on disable so late async decodes are ignored
  let session: { candidate: string; candidateStart: number; count: number } | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  function clearSession(): void {
    session = null;
    if (timeoutTimer !== null) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  function stopInternal(): void {
    enabled = false;
    unsubscribe?.();
    unsubscribe = null;
    generation++;
    clearSession();
  }

  function onRead(payload: string, t: number): void {
    if (!session) {
      session = { candidate: payload, candidateStart: t, count: 1 };
      options.onFirstRead?.();
      timeoutTimer = setTimeout(() => {
        timeoutTimer = null;
        if (!enabled) return;
        stopInternal();
        options.onTimeout?.();
      }, SCAN_TIMEOUT_MS);
    } else if (payload !== session.candidate || t - session.candidateStart > DWELL_WINDOW_MS) {
      session.candidate = payload;
      session.candidateStart = t;
      session.count = 1;
    } else {
      session.count++;
    }
    if (session && session.count >= DWELL_READS) {
      const locked = session.candidate;
      stopInternal();
      options.onLock(locked);
    }
  }

  function finish(gen: number, t: number, payload: string | null): void {
    busy = false;
    if (gen !== generation || !enabled) return;
    if (payload) onRead(payload, t);
  }

  function onFrame(frame: RgbaFrame): void {
    if (!enabled || busy) return;
    const t = Date.now();
    if (t - lastTick < SCAN_INTERVAL_MS) return;
    lastTick = t;
    const crop = cropCenter(frame);
    if (!crop) return;
    const gen = generation;
    busy = true;
    let result: string | null | Promise<string | null>;
    try {
      result = decode(crop);
    } catch {
      result = null;
    }
    if (result instanceof Promise) {
      result.then(
        (payload) => finish(gen, t, payload),
        () => finish(gen, t, null),
      );
    } else {
      finish(gen, t, result);
    }
  }

  return {
    enable() {
      if (enabled) return;
      enabled = true;
      lastTick = Number.NEGATIVE_INFINITY;
      const onFrameFn = options.camera?.onFrame;
      unsubscribe = typeof onFrameFn === 'function' ? onFrameFn.call(options.camera, onFrame) : null;
    },
    disable() {
      stopInternal();
    },
    get enabled() {
      return enabled;
    },
  };
}
