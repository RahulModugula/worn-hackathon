import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: unknown) {
    return { models: { generateContent } };
  }),
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW' },
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

import { attachSttProxy, buildDeepgramUrl, registerApiRoutes, STT_NO_KEY_CLOSE_CODE } from './api.js';

const jpeg = (tag = 'a') =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]).toString('base64');
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64');
const GOOD = { finding: 'Dressing intact.', comparison: 'No prior photo.', draftNote: 'Dressing intact.' };

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  registerApiRoutes(app);
  server = http.createServer(app);
  attachSttProxy(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  delete process.env.DEEPGRAM_API_KEY;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/assess-wound', () => {
  it('answers 200 with source fallback when no key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await post('/api/assess-wound', { captureId: 'c1', imageBase64: jpeg() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('fallback');
    expect(typeof body.finding).toBe('string');
    expect(typeof body.comparison).toBe('string');
    expect(typeof body.draftNote).toBe('string');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('returns the Gemini answer when the call succeeds', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    const body = await (await post('/api/assess-wound', { captureId: 'c2', imageBase64: jpeg() })).json();
    expect(body).toEqual({ captureId: 'c2', ...GOOD, source: 'gemini' });
  });

  it('uses the photo cached by /api/upload-wound-photo when no image is sent', async () => {
    const uploaded = jpeg('cached');
    await post('/api/upload-wound-photo', { captureId: 'cache-1', imageBase64: uploaded });
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });

    const body = await (await post('/api/assess-wound', { captureId: 'cache-1' })).json();

    expect(body.source).toBe('gemini');
    expect(generateContent.mock.calls[0][0].contents[0].parts[0].inlineData.data).toBe(uploaded);
  });

  it('answers from the fallback when the upload failed', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    const body = await (
      await post('/api/assess-wound', { captureId: 'c3', imageBase64: jpeg(), photoUploadFailed: true })
    ).json();
    expect(body.source).toBe('unavailable');
    expect(body.finding).toBe('Assessment unavailable: no photo captured');
    expect(body.draftNote).toBe('');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('answers unavailable (never a finding) when there is no photo at all', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });
    const body = await (await post('/api/assess-wound', { captureId: 'nophoto' })).json();
    expect(body).toMatchObject({ source: 'unavailable', finding: 'Assessment unavailable: no photo captured', comparison: '', draftNote: '' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects a non-JPEG image with 400', async () => {
    const res = await post('/api/assess-wound', { captureId: 'c4', imageBase64: PNG_B64 });
    expect(res.status).toBe(400);
  });

  it('rejects a missing or malformed captureId with 400', async () => {
    expect((await post('/api/assess-wound', { imageBase64: jpeg() })).status).toBe(400);
    expect((await post('/api/assess-wound', { captureId: '../etc', imageBase64: jpeg() })).status).toBe(400);
  });

  it('returns JSON 400 for malformed JSON bodies', async () => {
    const res = await post('/api/assess-wound', '{not json');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('GET /api/wound-photo/:captureId', () => {
  it('serves the uploaded JPEG bytes and 404s for unknown or malformed ids', async () => {
    await post('/api/upload-wound-photo', { captureId: 'g1', imageBase64: jpeg('serve') });
    const ok = await fetch(`${base}/api/wound-photo/g1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await ok.arrayBuffer()).toString('base64')).toBe(jpeg('serve'));
    expect((await fetch(`${base}/api/wound-photo/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/wound-photo/${'x'.repeat(80)}`)).status).toBe(404);
  });
});

describe('POST /api/upload-wound-photo', () => {
  it('stores a JPEG and accepts a retry with the same captureId', async () => {
    const first = await post('/api/upload-wound-photo', { captureId: 'r1', imageBase64: jpeg('one') });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, captureId: 'r1' });

    const retry = await post('/api/upload-wound-photo', { captureId: 'r1', imageBase64: jpeg('two') });
    expect(retry.status).toBe(200);
  });

  it('simulates an upload failure with a 502 JSON error', async () => {
    const res = await post('/api/upload-wound-photo', {
      captureId: 'f1',
      imageBase64: jpeg(),
      photoUploadFailed: true,
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'photo_upload_failed', message: "Photo didn't upload" });
  });

  it('rejects bodies over the 200KB limit with JSON 413', async () => {
    const res = await post('/api/upload-wound-photo', {
      captureId: 'big',
      imageBase64: jpeg('x'.repeat(210 * 1024)),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'payload_too_large' });
  });

  it('keeps at most 20 photos, evicting the oldest', async () => {
    for (let i = 0; i < 21; i++) {
      await post('/api/upload-wound-photo', { captureId: `evict-${i}`, imageBase64: jpeg(String(i)) });
    }
    generateContent.mockResolvedValue({ text: JSON.stringify(GOOD) });

    const oldest = await (await post('/api/assess-wound', { captureId: 'evict-0' })).json();
    const newest = await (await post('/api/assess-wound', { captureId: 'evict-20' })).json();

    expect(oldest.source).toBe('unavailable');
    expect(newest.source).toBe('gemini');
  });
});

describe('buildDeepgramUrl', () => {
  it('sets the streaming parameters and keyterms', () => {
    const url = new URL(buildDeepgramUrl('nova-3'));
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('interim_results')).toBe('true');
    expect(url.searchParams.get('endpointing')).toBe('300');
    expect(url.searchParams.getAll('keyterm')).toEqual([
      'done', 'next', 'undo', 'vitals', 'close', 'acknowledge', 'retry',
    ]);
    expect(url.href).not.toContain('Token');
  });
});

describe('/ws/stt proxy', () => {
  function connect(path: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}${path}`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }

  it('closes with a clear code when DEEPGRAM_API_KEY is missing', async () => {
    const client = await connect('/ws/stt');
    const closed = await waitClose(client);
    expect(closed.code).toBe(STT_NO_KEY_CLOSE_CODE);
    expect(closed.reason).toContain('DEEPGRAM_API_KEY');
  });

  it('forwards audio upstream with the key in the header and relays results back', async () => {
    const upstreamWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => upstreamWss.once('listening', r));
    const upstreamPort = (upstreamWss.address() as AddressInfo).port;

    const seen = { auth: '', audio: [] as Buffer[], text: [] as string[], closeStream: false };
    const upstreamClosed = new Promise<void>((resolve) => {
      upstreamWss.on('connection', (up, req) => {
        seen.auth = req.headers.authorization ?? '';
        up.on('message', (data, isBinary) => {
          if (isBinary) seen.audio.push(data as Buffer);
          else {
            seen.text.push(data.toString());
            if (data.toString().includes('CloseStream')) seen.closeStream = true;
          }
        });
        up.on('close', () => resolve());
        up.send(JSON.stringify({ type: 'Results', channel: { alternatives: [{ transcript: 'done' }] } }));
      });
    });

    process.env.DEEPGRAM_API_KEY = 'test-dg-key-not-real';
    // Point the proxy at the local fake upstream instead of api.deepgram.com.
    const proxyServer = http.createServer();
    attachSttProxy(proxyServer, { upstreamUrl: `ws://127.0.0.1:${upstreamPort}/` });
    await new Promise<void>((r) => proxyServer.listen(0, '127.0.0.1', r));
    const proxyBase = `ws://127.0.0.1:${(proxyServer.address() as AddressInfo).port}`;

    const client = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${proxyBase}/ws/stt`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
    const received = new Promise<string>((resolve) => client.once('message', (d) => resolve(d.toString())));

    client.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    expect(JSON.parse(await received).channel.alternatives[0].transcript).toBe('done');
    client.close(1000);

    await upstreamClosed;
    expect(seen.auth).toBe('Token test-dg-key-not-real');
    expect(seen.audio[0]).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(seen.closeStream).toBe(true);

    await new Promise<void>((r) => proxyServer.close(() => r()));
    await new Promise<void>((r) => upstreamWss.close(() => r()));
  });
});

