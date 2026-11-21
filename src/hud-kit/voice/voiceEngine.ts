import type { PlatformAdapter } from '../platform/types';

/**
 * Three-tier voice input with automatic fallback:
 *   1. Deepgram streaming via /ws/stt (only if GET /api/health reports deepgram: true).
 *   2. Web SpeechRecognition, restarted 150 ms after each onend.
 *   3. Platform tap / long press (always available).
 * A tier that fails at runtime falls to the next one. Tiers are not retried within a session.
 */

export type VoiceTier = 1 | 2 | 3;

export type VoiceEvent =
  | { type: 'transcript'; text: string; final: boolean; tier: 1 | 2 }
  | { type: 'tap' }
  | { type: 'longPress' }
  | { type: 'tier'; tier: VoiceTier; reason?: string }
  /** The microphone is genuinely capturing (permission granted and audio flowing), not merely requested. */
  | { type: 'mic'; live: boolean };

export type VoiceListener = (event: VoiceEvent) => void;

/** Wire format of the sample rate sent to the server. */
export const STT_SAMPLE_RATE = 16000;
const WS_OPEN = 1;
const WS_OPEN_TIMEOUT_MS = 3000;
const WATCHDOG_TICK_MS = 500;

export interface SocketLike {
  readonly readyState: number;
  binaryType?: string;
  send(data: ArrayBuffer): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: MediaStream): { connect(node: WorkletNodeLike): unknown };
  close?(): Promise<void>;
}

export interface WorkletNodeLike {
  port: { onmessage: ((ev: { data: Float32Array }) => void) | null };
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  /** Fires once the browser has granted the mic and started capturing. Optional: absent in minimal fakes. */
  onaudiostart?: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}

export interface VoiceEngineOptions {
  platform?: PlatformAdapter;
  healthUrl?: string;
  /** Defaults to ws(s)://<host>/ws/stt from the page location. */
  sttUrl?: string;
  fetchFn?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  createSocket?: (url: string) => SocketLike;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: (options: { sampleRate: number }) => AudioContextLike;
  createWorkletNode?: (ctx: AudioContextLike) => WorkletNodeLike;
  createSpeechRecognition?: () => SpeechRecognitionLike | null;
  now?: () => number;
  /** Tier 1 falls back after this long with no audio frames. Default 3000 ms. */
  silenceTimeoutMs?: number;
  /** Delay before restarting tier 2 after onend. Default 150 ms. */
  restartDelayMs?: number;
}

export interface VoiceEngine {
  /** Resolves with the tier that became active. Never rejects. */
  start(): Promise<VoiceTier | 0>;
  stop(): void;
  on(listener: VoiceListener): () => void;
  /** 0 while stopped or switching between tiers. */
  getTier(): VoiceTier | 0;
}

type Teardown = () => void;

const WORKLET_NAME = 'pcm16-capture';
const WORKLET_SOURCE = `
class Pcm16Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', Pcm16Capture);
`;

let workletUrlCache: string | null = null;
function workletUrl(): string {
  if (!workletUrlCache) {
    workletUrlCache = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  }
  return workletUrlCache;
}

/** Float32 [-1, 1] to little-endian Int16 PCM. */
export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** Accepts the server's simple `{ text, final }` shape or a raw Deepgram result. */
export function parseSttMessage(raw: unknown): { text: string; final: boolean } | null {
  let msg: unknown = raw;
  if (typeof raw === 'string') {
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as {
    text?: unknown;
    final?: unknown;
    is_final?: unknown;
    channel?: { alternatives?: Array<{ transcript?: unknown }> };
  };
  const alt = m.channel?.alternatives?.[0]?.transcript;
  const text = typeof m.text === 'string' ? m.text : typeof alt === 'string' ? alt : null;
  if (text === null || text.trim().length === 0) return null;
  return { text, final: m.final === true || m.is_final === true };
}

function defaultSttUrl(): string {
  const loc = (globalThis as { location?: Location }).location;
  if (!loc) return '';
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws/stt`;
}

function waitForOpen(socket: SocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws-timeout')), WS_OPEN_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('ws-error'));
    };
    socket.onclose = () => {
      clearTimeout(timer);
      reject(new Error('ws-closed'));
    };
  });
}

export function createVoiceEngine(options: VoiceEngineOptions = {}): VoiceEngine {
  const g = globalThis as Record<string, unknown>;
  const now = options.now ?? Date.now;
  const healthUrl = options.healthUrl ?? '/api/health';
  const sttUrl = options.sttUrl ?? defaultSttUrl();
  const silenceTimeoutMs = options.silenceTimeoutMs ?? 3000;
  const restartDelayMs = options.restartDelayMs ?? 150;

  const fetchFn =
    options.fetchFn ??
    ((url: string) => (g.fetch as (u: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>)(url));
  const createSocket =
    options.createSocket ??
    ((url: string) => {
      const socket = new (g.WebSocket as new (u: string) => SocketLike)(url);
      socket.binaryType = 'arraybuffer';
      return socket;
    });
  const getUserMedia =
    options.getUserMedia ??
    ((constraints: MediaStreamConstraints) =>
      (g.navigator as { mediaDevices: MediaDevices }).mediaDevices.getUserMedia(constraints));
  const createAudioContext =
    options.createAudioContext ??
    ((o: { sampleRate: number }) => new (g.AudioContext as new (o: unknown) => AudioContextLike)(o));
  const createWorkletNode =
    options.createWorkletNode ??
    ((ctx: AudioContextLike) =>
      new (g.AudioWorkletNode as new (c: unknown, n: string) => WorkletNodeLike)(ctx, WORKLET_NAME));
  const createSpeechRecognition =
    options.createSpeechRecognition ??
    (() => {
      const Ctor = (g.SpeechRecognition ?? g.webkitSpeechRecognition) as
        | (new () => SpeechRecognitionLike)
        | undefined;
      return typeof Ctor === 'function' ? new Ctor() : null;
    });

  const listeners = new Set<VoiceListener>();
  const platformUnsubs: Array<() => void> = [];
  let running = false;
  let tier: VoiceTier | 0 = 0;
  let activeTeardown: Teardown | null = null;

  function emit(event: VoiceEvent): void {
    for (const cb of listeners) {
      try {
        cb(event);
      } catch (err) {
        console.error('voice listener failed', err);
      }
    }
  }

  let micLive = false;
  function setMic(live: boolean): void {
    if (micLive === live) return;
    micLive = live;
    emit({ type: 'mic', live });
  }

  function setTier(next: VoiceTier, reason?: string): void {
    tier = next;
    emit(reason === undefined ? { type: 'tier', tier: next } : { type: 'tier', tier: next, reason });
    // Tier 1 is only reached after getUserMedia resolved (permission granted). Tier 2 reports it from onaudiostart.
    setMic(next === 1);
  }

  function teardownActive(): void {
    const fn = activeTeardown;
    activeTeardown = null;
    tier = 0; // set first so late callbacks from the dying tier are ignored
    setMic(false);
    fn?.();
  }

  /** Called by a tier when it fails at runtime. Ignored if that tier is not the active one. */
  function fail(from: 1 | 2, reason: string): void {
    if (!running || tier !== from) return;
    teardownActive();
    void startFrom((from + 1) as VoiceTier, reason);
  }

  async function tryDeepgram(): Promise<Teardown | null> {
    let healthy = false;
    try {
      const res = await fetchFn(healthUrl);
      if (res.ok) {
        const body = (await res.json()) as { deepgram?: unknown } | null;
        healthy = body?.deepgram === true;
      }
    } catch {
      healthy = false;
    }
    if (!healthy) return null;

    const cleanups: Teardown[] = [];
    const release = (): void => {
      for (const fn of cleanups.splice(0).reverse()) {
        try {
          fn();
        } catch {
          // Best-effort teardown: a dead socket or closed context must not block the next tier.
        }
      }
    };
    try {
      const socket = createSocket(sttUrl);
      cleanups.push(() => socket.close());
      await waitForOpen(socket);
      socket.onmessage = (ev) => {
        const parsed = parseSttMessage(ev.data);
        if (parsed) emit({ type: 'transcript', text: parsed.text, final: parsed.final, tier: 1 });
      };
      // The socket can die while the mic prompt or audio setup is still pending (tier is not 1 yet): remember it.
      let dead = false;
      socket.onerror = () => { dead = true; fail(1, 'ws-error'); };
      socket.onclose = () => { dead = true; fail(1, 'ws-closed'); };

      const stream = await getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      cleanups.push(() => stream.getTracks().forEach((track) => track.stop()));
      if (dead) throw new Error('ws-closed');

      const ctx = createAudioContext({ sampleRate: STT_SAMPLE_RATE });
      cleanups.push(() => {
        void ctx.close?.();
      });
      if (ctx.sampleRate !== STT_SAMPLE_RATE) throw new Error('sample-rate-unsupported');
      await ctx.audioWorklet.addModule(workletUrl());
      const node = createWorkletNode(ctx);
      ctx.createMediaStreamSource(stream).connect(node);
      if (dead) throw new Error('ws-closed');

      let lastAudioAt = now();
      node.port.onmessage = (ev) => {
        lastAudioAt = now();
        if (socket.readyState === WS_OPEN) socket.send(floatToPcm16(ev.data));
      };
      const watchdog = setInterval(() => {
        if (now() - lastAudioAt > silenceTimeoutMs) fail(1, 'no-audio');
      }, WATCHDOG_TICK_MS);
      cleanups.push(() => clearInterval(watchdog));
      return release;
    } catch {
      release();
      return null;
    }
  }

  function trySpeech(): Teardown | null {
    let rec: SpeechRecognitionLike | null;
    try {
      rec = createSpeechRecognition();
    } catch {
      rec = null;
    }
    if (!rec) return null;
    const recognizer = rec;
    let live = true;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';
    recognizer.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const alt = result?.[0];
        if (alt && typeof alt.transcript === 'string') {
          emit({ type: 'transcript', text: alt.transcript, final: result.isFinal === true, tier: 2 });
        }
      }
    };
    recognizer.onaudiostart = () => {
      if (live && tier === 2) setMic(true);
    };
    recognizer.onend = () => {
      if (!live) return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!live) return;
        try {
          recognizer.start();
        } catch {
          // Already running: the next onend will try again.
        }
      }, restartDelayMs);
    };
    recognizer.onerror = (ev) => {
      if (!live) return;
      if (ev.error === 'no-speech' || ev.error === 'aborted') return; // onend restarts these
      fail(2, ev.error ?? 'error');
    };
    try {
      recognizer.start();
    } catch {
      live = false;
      return null;
    }
    return () => {
      live = false;
      if (restartTimer !== null) clearTimeout(restartTimer);
      try {
        recognizer.stop();
      } catch {
        // Already stopped.
      }
    };
  }

  async function startFrom(first: VoiceTier, reason?: string): Promise<void> {
    for (let t = first; t <= 3; t++) {
      const candidate = t as VoiceTier;
      const teardown: Teardown | null =
        candidate === 1 ? await tryDeepgram() : candidate === 2 ? trySpeech() : () => {};
      if (!running) {
        teardown?.();
        return;
      }
      if (teardown) {
        activeTeardown = teardown;
        setTier(candidate, reason);
        return;
      }
    }
  }

  return {
    async start() {
      if (running) return tier;
      running = true;
      const p = options.platform;
      if (p) {
        platformUnsubs.push(p.input.onTap(() => emit({ type: 'tap' })));
        platformUnsubs.push(p.input.onLongPress(() => emit({ type: 'longPress' })));
      }
      await startFrom(1);
      return tier;
    },
    stop() {
      running = false;
      teardownActive();
      for (const unsub of platformUnsubs.splice(0)) unsub();
    },
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getTier() {
      return tier;
    },
  };
}
