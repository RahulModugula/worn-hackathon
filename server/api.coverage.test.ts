import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachSttProxy, registerApiRoutes } from './api.js';

// Real express + real ws sockets. Nothing about the code under test is mocked.
const jpeg = (tag = 'a') =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]).toString('base64');

const listen = (s: http.Server) =>
  new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const closeServer = (s: http.Server) => new Promise<void>((r) => { s.closeAllConnections?.(); s.close(() => r()); });

describe('api routes: validation, eviction and error shape', () => {
  let server: http.Server;
  let base: string;
  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    const app = express();
    registerApiRoutes(app);
    server = http.createServer(app);
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  afterEach(() => closeServer(server));

  const post = (path: string, body: unknown, raw = false) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    });

  it('rejects capture ids that are not simple tokens, on every route', async () => {
    for (const bad of ['', '../etc/passwd', 'a b', 'x'.repeat(200), 7, null]) {
      const a = await post('/api/upload-wound-photo', { captureId: bad, imageBase64: jpeg() });
      expect(a.status, `upload ${String(bad)}`).toBe(400);
      const b = await post('/api/assess-wound', { captureId: bad });
      expect(b.status, `assess ${String(bad)}`).toBe(400);
    }
    expect((await fetch(`${base}/api/wound-photo/..%2Fsecret`)).status).toBe(404);
  });

  it('refuses a non-JPEG upload and an oversize body as JSON, not an HTML page', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    expect((await post('/api/upload-wound-photo', { captureId: 'c1', imageBase64: png })).status).toBe(400);
    const huge = await post('/api/upload-wound-photo', { captureId: 'c1', imageBase64: jpeg('z'.repeat(8_000_000)) });
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({ ok: false, error: 'payload_too_large' });
  });

  it('maps malformed JSON to a JSON 400 without leaking the parser message', async () => {
    const res = await post('/api/upload-wound-photo', '{not json', true);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'bad_request' });
  });

  it('serves a stored photo back byte for byte, no-store, and evicts the oldest past the cap', async () => {
    const first = jpeg('first');
    await post('/api/upload-wound-photo', { captureId: 'cap-0', imageBase64: first });
    const got = await fetch(`${base}/api/wound-photo/cap-0`);
    expect(got.headers.get('content-type')).toContain('image/jpeg');
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await got.arrayBuffer()).toString('base64')).toBe(first);
    for (let i = 1; i <= 40; i++) await post('/api/upload-wound-photo', { captureId: `cap-${i}`, imageBase64: jpeg(String(i)) });
    expect((await fetch(`${base}/api/wound-photo/cap-0`)).status).toBe(404);
    expect((await fetch(`${base}/api/wound-photo/cap-40`)).status).toBe(200);
  });

  it('with a photo upload failure flag, assess says unavailable instead of inventing a finding', async () => {
    await post('/api/upload-wound-photo', { captureId: 'cu', imageBase64: jpeg() });
    const res = await post('/api/assess-wound', { captureId: 'cu', photoUploadFailed: true });
    expect((await res.json()).source).toBe('unavailable');
  });
});

describe('/ws/stt proxy: lifecycle edge cases', () => {
  let proxy: http.Server;
  let proxyPort: number;
  let upstream: WebSocketServer;
  let upstreamPort: number;
  const opened: WebSocket[] = [];

  beforeEach(async () => {
    process.env.DEEPGRAM_API_KEY = 'test-dg-key-not-real';
    upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => upstream.once('listening', r));
    upstreamPort = (upstream.address() as AddressInfo).port;
  });
  afterEach(async () => {
    delete process.env.DEEPGRAM_API_KEY;
    for (const w of opened.splice(0)) w.terminate();
    for (const c of upstream.clients) c.terminate();
    await new Promise<void>((r) => upstream.close(() => r()));
    if (proxy) await closeServer(proxy);
  });

  const start = async (maxClients?: number) => {
    proxy = http.createServer();
    attachSttProxy(proxy, { upstreamUrl: `ws://127.0.0.1:${upstreamPort}/`, maxClients });
    proxyPort = await listen(proxy);
  };
  const connect = () =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/ws/stt`);
      opened.push(ws);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  const closed = (ws: WebSocket) =>
    new Promise<{ code: number; reason: string }>((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));

  it('answers 503 once maxClients sockets are open', async () => {
    await start(1);
    await connect();
    const status = await new Promise<string>((resolve) => {
      const s = net.connect(proxyPort, '127.0.0.1', () =>
        s.write('GET /ws/stt HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
      s.once('data', (d) => { resolve(d.toString().split('\r\n')[0]); s.destroy(); });
    });
    expect(status).toContain('503');
  });

  it('destroys a malformed upgrade target instead of throwing', async () => {
    await start();
    const ended = await new Promise<boolean>((resolve) => {
      const s = net.connect(proxyPort, '127.0.0.1', () =>
        s.write('GET //// HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'));
      s.once('close', () => resolve(true));
      s.once('error', () => resolve(true));
    });
    expect(ended).toBe(true);
    await connect(); // the server is still serving after the bad upgrade
  });

  it('buffers audio sent before upstream opens, then flushes it in order', async () => {
    await start();
    const got: number[] = [];
    const done = new Promise<void>((resolve) => {
      upstream.on('connection', (up) => up.on('message', (d, bin) => {
        if (!bin) return;
        got.push((d as Buffer)[0]);
        if (got.length === 3) resolve();
      }));
    });
    const c = await connect();
    c.send(Buffer.from([1]), { binary: true });
    c.send(Buffer.from([2]), { binary: true });
    c.send('{"type":"ignored-text"}'); // control frames from the client are never forwarded
    c.send(Buffer.from([3]), { binary: true });
    await done;
    expect(got).toEqual([1, 2, 3]);
  });

  it('closes the browser socket with 1011 when upstream dies abnormally, 1000 when it ends cleanly', async () => {
    await start();
    upstream.once('connection', (up) => up.close(1000));
    const c1 = await connect();
    expect((await closed(c1)).code).toBe(1000);

    upstream.once('connection', (up) => up.terminate());
    const c2 = await connect();
    expect((await closed(c2)).code).toBe(1011);
  });

  it('closes 1011 when the upstream cannot be reached', async () => {
    await start();
    await new Promise<void>((r) => upstream.close(() => r()));
    upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' }); // so afterEach has something to close
    const orig = console.error;
    console.error = () => {};
    try {
      const c = await connect();
      expect((await closed(c)).code).toBe(1011);
    } finally { console.error = orig; }
  });

  it('terminates upstream when the browser leaves before upstream is open', async () => {
    await start();
    let upstreamClosed: Promise<void> | undefined;
    upstream.once('connection', (up) => { upstreamClosed = new Promise((r) => up.once('close', () => r())); });
    const c = await connect();
    c.terminate();
    await new Promise((r) => setTimeout(r, 150));
    if (upstreamClosed) await upstreamClosed;
    expect(upstream.clients.size).toBe(0);
  });
});
