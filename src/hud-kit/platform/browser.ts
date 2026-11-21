import type {
  AvailabilityResult,
  CameraAdapter,
  InputAdapter,
  MicAdapter,
  PlatformAdapter,
  RgbaFrame,
} from './types';

export const CAMERA_WIDTH = 1280;
export const CAMERA_HEIGHT = 720;
/** 4 FPS, matching the scanner cadence. */
const FRAME_INTERVAL_MS = 250;
/** HAVE_CURRENT_DATA: the first frame is decodable. */
const READY_STATE_HAVE_DATA = 2;

/** Error names are short and log-safe; error messages can echo device labels, so they are not used. */
function reasonOf(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.length > 0 ? name : 'unknown';
}

function mediaDevices(): MediaDevices | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
}

function notifyAll<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const cb of listeners) {
    try {
      cb(value);
    } catch (err) {
      console.error('platform listener failed', err);
    }
  }
}

/**
 * Rear camera at 1280x720, pumped to RGBA frames at 4 FPS through a canvas.
 * `start()` never throws: on any failure it resolves with `{ available: false }`.
 */
export function createBrowserCamera(): CameraAdapter {
  const listeners = new Set<(frame: RgbaFrame) => void>();
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function release(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) video.srcObject = null;
    video = null;
    ctx = null;
  }

  function pump(): void {
    if (!video || !ctx || listeners.size === 0 || video.readyState < READY_STATE_HAVE_DATA) return;
    try {
      ctx.drawImage(video, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
      const image = ctx.getImageData(0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
      notifyAll(listeners, { width: CAMERA_WIDTH, height: CAMERA_HEIGHT, data: image.data });
    } catch (err) {
      console.error('camera frame capture failed', err);
    }
  }

  function setTracks(enabled: boolean): void {
    stream?.getTracks().forEach((track) => { track.enabled = enabled; });
  }

  return {
    pause() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      setTracks(false);
    },
    resume() {
      if (!stream) return;
      setTracks(true);
      if (timer === null && video) timer = setInterval(pump, FRAME_INTERVAL_MS);
    },
    async start(): Promise<AvailabilityResult> {
      if (stream) return { available: true };
      const devices = mediaDevices();
      if (!devices || typeof devices.getUserMedia !== 'function' || typeof document === 'undefined') {
        return { available: false, reason: 'unsupported' };
      }
      try {
        stream = await devices.getUserMedia({
          video: { width: { ideal: CAMERA_WIDTH }, height: { ideal: CAMERA_HEIGHT }, facingMode: 'environment' },
          audio: false,
        });
        const el = document.createElement('video');
        el.muted = true;
        el.playsInline = true;
        el.srcObject = stream;
        await el.play().catch(() => undefined); // autoplay refusal: pump waits for readyState instead
        const canvas = document.createElement('canvas');
        canvas.width = CAMERA_WIDTH;
        canvas.height = CAMERA_HEIGHT;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2d context unavailable');
        video = el;
        ctx = context;
        timer = setInterval(pump, FRAME_INTERVAL_MS);
        return { available: true };
      } catch (err) {
        release();
        return { available: false, reason: reasonOf(err) };
      }
    },
    stop: release,
    onFrame(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/**
 * Probes microphone permission only. Speech is recognised by the voice engine, not here,
 * so the probe tracks are stopped immediately. `onTranscript` never fires in a browser.
 */
export function createBrowserMic(): MicAdapter {
  return {
    async start(): Promise<AvailabilityResult> {
      const devices = mediaDevices();
      if (!devices || typeof devices.getUserMedia !== 'function') {
        return { available: false, reason: 'unsupported' };
      }
      try {
        const probe = await devices.getUserMedia({ audio: true });
        probe.getTracks().forEach((track) => track.stop());
        return { available: true };
      } catch (err) {
        return { available: false, reason: reasonOf(err) };
      }
    },
    stop() {},
    onTranscript() {
      return () => {};
    },
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el) return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function keyListener(key: string, cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (ev: KeyboardEvent) => {
    if (ev.key === key && !ev.repeat && !isEditableTarget(ev.target)) cb();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

/** Desktop stand-in for the glasses' input (also the wrapper's DOM twins): Space or Enter is a tap, Escape a long press. */
export function createBrowserInput(): InputAdapter {
  return {
    onTap: (cb) => {
      const offs = [keyListener(' ', cb), keyListener('Enter', cb)];
      return () => offs.forEach((f) => f());
    },
    onLongPress: (cb) => keyListener('Escape', cb),
  };
}

export function createBrowserPlatform(): PlatformAdapter {
  return {
    name: 'browser',
    camera: createBrowserCamera(),
    mic: createBrowserMic(),
    input: createBrowserInput(),
  };
}
