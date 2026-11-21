import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceEngine, type SocketLike, type SpeechRecognitionLike, type VoiceEvent } from './voiceEngine';

// Tier 1 (streamed STT) end to end with hand-written fakes for the browser APIs only.
class FakeSocket implements SocketLike {
  readyState = 1;
  sent: ArrayBuffer[] = [];
  closed = false;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  send(d: ArrayBuffer) { this.sent.push(d); }
  close() { this.closed = true; }
}

function rig(over: { sampleRate?: number; mic?: () => Promise<MediaStream>; speech?: boolean } = {}) {
  const socket = new FakeSocket();
  const tracks = { stopped: 0 };
  const port: { onmessage: ((ev: { data: Float32Array }) => void) | null } = { onmessage: null };
  let clock = 0;
  let ctxClosed = false;
  const recs: Array<{ started: number }> = [];
  const engine = createVoiceEngine({
    fetchFn: async () => ({ ok: true, json: async () => ({ deepgram: true }) }),
    sttUrl: 'ws://test.invalid/ws/stt',
    createSocket: () => { queueMicrotask(() => socket.onopen?.({})); return socket; },
    getUserMedia: over.mic ?? (async () => ({ getTracks: () => [{ stop: () => { tracks.stopped++; } }] }) as unknown as MediaStream),
    createAudioContext: () => ({
      sampleRate: over.sampleRate ?? 16000,
      audioWorklet: { addModule: async () => undefined },
      createMediaStreamSource: () => ({ connect: () => undefined }),
      close: async () => { ctxClosed = true; },
    }),
    createWorkletNode: () => ({ port }),
    createSpeechRecognition: over.speech === false ? () => null : () => {
      const r = { started: 0 };
      recs.push(r);
      return { continuous: false, interimResults: false, lang: '', start() { r.started++; }, stop() {}, onresult: null, onend: null, onerror: null } as SpeechRecognitionLike;
    },
    now: () => clock,
    silenceTimeoutMs: 3000,
  });
  const events: VoiceEvent[] = [];
  engine.on((e) => events.push(e));
  return { engine, socket, port, tracks, events, recs, tick: (ms: number) => { clock += ms; }, ctxClosed: () => ctxClosed };
}

describe('voiceEngine tier 1 streaming', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('streams worklet audio as clamped PCM16, relays transcripts, and ignores junk frames', async () => {
    const r = rig();
    expect(await r.engine.start()).toBe(1);
    expect(r.events).toContainEqual({ type: 'mic', live: true });

    r.port.onmessage?.({ data: new Float32Array([0, 2, -2]) });
    const pcm = new Int16Array(r.socket.sent[0]);
    expect(Array.from(pcm)).toEqual([0, 32767, -32768]);

    r.socket.onmessage?.({ data: JSON.stringify({ channel: { alternatives: [{ transcript: 'hello there' }] }, is_final: true }) });
    r.socket.onmessage?.({ data: 'not json' });
    r.socket.onmessage?.({ data: JSON.stringify({ channel: { alternatives: [{ transcript: '  ' }] } }) });
    const transcripts = r.events.filter((e) => e.type === 'transcript');
    expect(transcripts).toEqual([{ type: 'transcript', text: 'hello there', final: true, tier: 1 }]);
  });

  it('does not write to a socket that is no longer open', async () => {
    const r = rig();
    await r.engine.start();
    r.socket.readyState = 3;
    r.port.onmessage?.({ data: new Float32Array([0.5]) });
    expect(r.socket.sent).toHaveLength(0);
  });

  it('falls to tier 2 when no audio frame arrives within the silence timeout', async () => {
    const r = rig();
    await r.engine.start();
    r.tick(3500);
    await vi.advanceTimersByTimeAsync(600);
    expect(r.engine.getTier()).toBe(2);
    expect(r.socket.closed).toBe(true);
    expect(r.events).toContainEqual({ type: 'tier', tier: 2, reason: 'no-audio' });
  });

  it('keeps tier 1 while frames keep arriving inside the timeout', async () => {
    const r = rig();
    await r.engine.start();
    for (let i = 0; i < 5; i++) {
      r.tick(2000);
      r.port.onmessage?.({ data: new Float32Array([0.1]) });
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(r.engine.getTier()).toBe(1);
  });

  it('releases the socket and skips tier 1 when the mic is denied', async () => {
    const r = rig({ mic: async () => { throw new Error('NotAllowedError'); } });
    expect(await r.engine.start()).toBe(2);
    expect(r.socket.closed).toBe(true);
    expect(r.events.some((e) => e.type === 'mic' && e.live)).toBe(false);
  });

  it('rejects an audio context that cannot run at 16 kHz and frees the mic and context', async () => {
    const r = rig({ sampleRate: 48000 });
    expect(await r.engine.start()).toBe(2);
    expect(r.tracks.stopped).toBe(1);
    expect(r.socket.closed).toBe(true);
    expect(r.ctxClosed()).toBe(true);
  });

  it('lands on tier 3 (typed fallback) when every tier fails, and stop() releases tier 1 resources', async () => {
    const dead = rig({ speech: false, mic: async () => { throw new Error('no'); } });
    expect(await dead.engine.start()).toBe(3);

    const live = rig();
    await live.engine.start();
    live.engine.stop();
    expect(live.engine.getTier()).toBe(0);
    expect(live.socket.closed).toBe(true);
    expect(live.tracks.stopped).toBe(1);
    expect(live.events).toContainEqual({ type: 'mic', live: false });
  });

  it('stop() while the tier-1 mic prompt is pending leaves nothing running', async () => {
    let release: () => void = () => {};
    const mic = new Promise<MediaStream>((res) => { release = () => res({ getTracks: () => [] } as unknown as MediaStream); });
    const r = rig({ mic: () => mic });
    const started = r.engine.start();
    await vi.advanceTimersByTimeAsync(10);
    r.engine.stop();
    release();
    await started;
    expect(r.engine.getTier()).toBe(0);
    expect(r.socket.closed).toBe(true);
  });

  it('a throwing listener cannot break event delivery to the others', async () => {
    const r = rig({ speech: false, mic: async () => { throw new Error('x'); } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    r.engine.on(() => { throw new Error('bad listener'); });
    r.engine.on((e) => seen.push(e.type));
    await r.engine.start();
    expect(seen).toContain('tier');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
