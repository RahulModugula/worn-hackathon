import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../platform/types';
import {
  createVoiceEngine,
  floatToPcm16,
  parseSttMessage,
  type SocketLike,
  type SpeechRecognitionLike,
  type VoiceEvent,
} from './voiceEngine';

function fakePlatform() {
  const cbs: { tap?: () => void; longPress?: () => void } = {};
  const platform = {
    name: 'browser',
    camera: { start: async () => ({ available: false }), stop() {}, onFrame: () => () => {} },
    mic: { start: async () => ({ available: false }), stop() {}, onTranscript: () => () => {} },
    input: {
      onTap: (cb: () => void) => {
        cbs.tap = cb;
        return () => {
          cbs.tap = undefined;
        };
      },
      onLongPress: (cb: () => void) => {
        cbs.longPress = cb;
        return () => {
          cbs.longPress = undefined;
        };
      },
    },
  } as unknown as PlatformAdapter;
  return { platform, cbs };
}

function fakeSpeech() {
  const instances: FakeRec[] = [];
  class FakeRec implements SpeechRecognitionLike {
    continuous = false;
    interimResults = false;
    lang = '';
    onresult: SpeechRecognitionLike['onresult'] = null;
    onend: SpeechRecognitionLike['onend'] = null;
    onaudiostart: SpeechRecognitionLike['onaudiostart'] = null;
    onerror: SpeechRecognitionLike['onerror'] = null;
    starts = 0;
    stops = 0;
    start() {
      this.starts++;
    }
    stop() {
      this.stops++;
    }
  }
  return {
    instances,
    create: () => {
      const rec = new FakeRec();
      instances.push(rec);
      return rec;
    },
  };
}

function result(text: string, isFinal: boolean) {
  return Object.assign([{ transcript: text }], { isFinal });
}

const deepgramOff = async () => ({ ok: true, json: async () => ({ deepgram: false }) });

describe('voiceEngine tier selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls to tier 3 when deepgram is off and SpeechRecognition is missing, and forwards taps', async () => {
    const { platform, cbs } = fakePlatform();
    const engine = createVoiceEngine({
      platform,
      fetchFn: deepgramOff,
      createSpeechRecognition: () => null,
    });
    const events: VoiceEvent[] = [];
    engine.on((e) => events.push(e));
    expect(await engine.start()).toBe(3);
    expect(events).toContainEqual({ type: 'tier', tier: 3 });
    cbs.tap?.();
    cbs.longPress?.();
    expect(events).toContainEqual({ type: 'tap' });
    expect(events).toContainEqual({ type: 'longPress' });
  });

  it('uses tier 2 when deepgram is off and forwards interim and final results', async () => {
    const speech = fakeSpeech();
    const engine = createVoiceEngine({
      platform: fakePlatform().platform,
      fetchFn: deepgramOff,
      createSpeechRecognition: speech.create,
    });
    const events: VoiceEvent[] = [];
    engine.on((e) => events.push(e));
    expect(await engine.start()).toBe(2);
    const rec = speech.instances[0];
    expect(rec.continuous && rec.interimResults).toBe(true);
    rec.onresult?.({ resultIndex: 0, results: [result('alpha', false)] });
    rec.onresult?.({ resultIndex: 0, results: [result('alpha beta', true)] });
    expect(events).toContainEqual({ type: 'transcript', text: 'alpha', final: false, tier: 2 });
    expect(events).toContainEqual({ type: 'transcript', text: 'alpha beta', final: true, tier: 2 });
  });

  it('mic events: tier 2 is "live" only once the browser starts capturing (not when merely requested); denial and tier 3 are never live', async () => {
    const speech = fakeSpeech();
    const engine = createVoiceEngine({
      platform: fakePlatform().platform,
      fetchFn: deepgramOff,
      createSpeechRecognition: speech.create,
    });
    const events: VoiceEvent[] = [];
    engine.on((e) => events.push(e));
    await engine.start();
    const mic = () => events.filter((e) => e.type === 'mic');
    expect(engine.getTier()).toBe(2);
    expect(mic()).toEqual([]); // recognizer.start() was called but no permission or audio yet
    speech.instances[0].onaudiostart?.();
    expect(mic()).toEqual([{ type: 'mic', live: true }]);
    speech.instances[0].onerror?.({ error: 'not-allowed' }); // falls to tier 3: no mic
    expect(mic()).toEqual([{ type: 'mic', live: true }, { type: 'mic', live: false }]);

    const t3: VoiceEvent[] = [];
    const e3 = createVoiceEngine({ platform: fakePlatform().platform, fetchFn: deepgramOff, createSpeechRecognition: () => null });
    e3.on((e) => t3.push(e));
    await e3.start();
    expect(t3.some((e) => e.type === 'mic')).toBe(false);
  });

  it('restarts recognition 150 ms after onend', async () => {
    const speech = fakeSpeech();
    const engine = createVoiceEngine({
      platform: fakePlatform().platform,
      fetchFn: deepgramOff,
      createSpeechRecognition: speech.create,
    });
    await engine.start();
    const rec = speech.instances[0];
    expect(rec.starts).toBe(1);
    rec.onend?.();
    vi.advanceTimersByTime(149);
    expect(rec.starts).toBe(1);
    vi.advanceTimersByTime(1);
    expect(rec.starts).toBe(2);
  });

  it('a fatal recognition error falls to tier 3 and stops restarts; no-speech is ignored', async () => {
    const speech = fakeSpeech();
    const engine = createVoiceEngine({
      platform: fakePlatform().platform,
      fetchFn: deepgramOff,
      createSpeechRecognition: speech.create,
    });
    const events: VoiceEvent[] = [];
    engine.on((e) => events.push(e));
    await engine.start();
    const rec = speech.instances[0];

    rec.onerror?.({ error: 'no-speech' });
    expect(engine.getTier()).toBe(2);

    rec.onerror?.({ error: 'not-allowed' });
    expect(engine.getTier()).toBe(3);
    expect(events).toContainEqual({ type: 'tier', tier: 3, reason: 'not-allowed' });

    rec.onend?.();
    vi.advanceTimersByTime(1000);
    expect(rec.starts).toBe(1);
  });

  it('tier 1 is skipped when the socket fails to open and the engine lands on tier 2', async () => {
    const speech = fakeSpeech();
    const createSocket = vi.fn((): SocketLike => {
      const socket: SocketLike = {
        readyState: 0,
        send() {},
        close() {},
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
      };
      queueMicrotask(() => socket.onerror?.({}));
      return socket;
    });
    const engine = createVoiceEngine({
      platform: fakePlatform().platform,
      fetchFn: async () => ({ ok: true, json: async () => ({ deepgram: true }) }),
      sttUrl: 'ws://test.invalid/ws/stt',
      createSocket,
      createSpeechRecognition: speech.create,
    });
    expect(await engine.start()).toBe(2);
    expect(createSocket).toHaveBeenCalledWith('ws://test.invalid/ws/stt');
  });

  describe('tier 1 socket closing', () => {
    function rig() {
      const speech = fakeSpeech();
      const sockets: SocketLike[] = [];
      const createSocket = (): SocketLike => {
        const socket: SocketLike = { readyState: 1, send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
        sockets.push(socket);
        queueMicrotask(() => socket.onopen?.({}));
        return socket;
      };
      let releaseMic: () => void = () => {};
      const micPromise = new Promise<MediaStream>((r) => { releaseMic = () => r({ getTracks: () => [] } as unknown as MediaStream); });
      const ctx = {
        sampleRate: 16000,
        audioWorklet: { addModule: async () => undefined },
        createMediaStreamSource: () => ({ connect: () => undefined }),
        close: async () => undefined,
      };
      const engine = createVoiceEngine({
        platform: fakePlatform().platform,
        fetchFn: async () => ({ ok: true, json: async () => ({ deepgram: true }) }),
        sttUrl: 'ws://test.invalid/ws/stt',
        createSocket,
        getUserMedia: () => micPromise,
        createAudioContext: () => ctx,
        createWorkletNode: () => ({ port: { onmessage: null } }),
        createSpeechRecognition: speech.create,
      });
      return { engine, sockets, releaseMic, speech };
    }

    it('falls to tier 2 when the socket closes while getUserMedia is still prompting', async () => {
      const r = rig();
      const started = r.engine.start();
      await vi.advanceTimersByTimeAsync(10); // socket open, mic prompt pending
      r.sockets[0].onclose?.({});
      r.releaseMic();
      expect(await started).toBe(2);
      expect(r.engine.getTier()).toBe(2);
    });

    it('falls to tier 2 when the socket closes after tier 1 is running', async () => {
      const r = rig();
      const started = r.engine.start();
      await vi.advanceTimersByTimeAsync(10);
      r.releaseMic();
      expect(await started).toBe(1);
      r.sockets[0].onclose?.({});
      await vi.advanceTimersByTimeAsync(10);
      expect(r.engine.getTier()).toBe(2);
      expect(r.speech.instances.length).toBe(1);
    });
  });

  it('stop() unsubscribes platform taps and resets the tier', async () => {
    const { platform, cbs } = fakePlatform();
    const engine = createVoiceEngine({ platform, fetchFn: deepgramOff, createSpeechRecognition: () => null });
    const events: VoiceEvent[] = [];
    engine.on((e) => events.push(e));
    await engine.start();
    engine.stop();
    expect(engine.getTier()).toBe(0);
    expect(cbs.tap).toBeUndefined();
    expect(events.filter((e) => e.type === 'tap')).toHaveLength(0);
  });
});

describe('voice wire helpers', () => {
  it('parseSttMessage accepts the simple and raw Deepgram shapes and rejects junk', () => {
    expect(parseSttMessage('{"text":"alpha","final":true}')).toEqual({ text: 'alpha', final: true });
    expect(
      parseSttMessage(JSON.stringify({ is_final: false, channel: { alternatives: [{ transcript: 'beta' }] } })),
    ).toEqual({ text: 'beta', final: false });
    expect(parseSttMessage('not json')).toBeNull();
    expect(parseSttMessage(new ArrayBuffer(8))).toBeNull();
    expect(parseSttMessage('{"text":"  "}')).toBeNull();
  });

  it('floatToPcm16 scales and clamps to little-endian Int16', () => {
    const out = new Int16Array(floatToPcm16(new Float32Array([1, -1, 0, 2])));
    expect(Array.from(out)).toEqual([32767, -32768, 0, 32767]);
  });
});
