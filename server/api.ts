import type http from 'node:http';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { assessWound, unavailableAssessment, isJpegBase64 } from './assessWound.js';
import { recordAssessmentSource } from './captureSources.js';

const BODY_LIMIT = '200kb';
const MAX_PHOTOS = 20;
const CAPTURE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const STT_PATH = '/ws/stt';
/** Private close code sent to the browser when the server has no DEEPGRAM_API_KEY. */
export const STT_NO_KEY_CLOSE_CODE = 4503;
const KEYTERMS = ['done', 'next', 'undo', 'vitals', 'close', 'acknowledge', 'retry'];
const KEEPALIVE_MS = 4000;
const MAX_QUEUED_FRAMES = 50;

function badRequest(res: Response, message: string): void {
  res.status(400).json({ ok: false, error: 'bad_request', message });
}

function validCaptureId(value: unknown): value is string {
  return typeof value === 'string' && CAPTURE_ID.test(value);
}

/** Express routes for the bedside glance: wound assessment and photo upload with retry. */
export function registerApiRoutes(app: Express): void {
  // Insertion-ordered: re-storing an id moves it to the end, the oldest entry is evicted first.
  const photos = new Map<string, string>();
  const jsonBody = express.json({ limit: BODY_LIMIT });

  app.post('/api/assess-wound', jsonBody, async (req: Request, res: Response) => {
    const { captureId, imageBase64, photoUploadFailed } = req.body ?? {};
    if (!validCaptureId(captureId)) return badRequest(res, 'captureId is required');
    if (imageBase64 !== undefined && !isJpegBase64(imageBase64)) {
      return badRequest(res, 'imageBase64 must be a base64 JPEG');
    }

    // A failed upload or a missing photo means there is nothing to assess: say so, never invent a finding.
    const image =
      photoUploadFailed === true ? undefined : ((imageBase64 as string | undefined) ?? photos.get(captureId));
    const result = image ? await assessWound(image) : unavailableAssessment();
    recordAssessmentSource(captureId, result.source);
    res.json({ captureId, ...result });
  });

  app.post('/api/upload-wound-photo', jsonBody, (req: Request, res: Response) => {
    const { captureId, imageBase64, photoUploadFailed } = req.body ?? {};
    if (!validCaptureId(captureId)) return badRequest(res, 'captureId is required');
    if (photoUploadFailed === true) {
      return res.status(502).json({ ok: false, error: 'photo_upload_failed', message: "Photo didn't upload" });
    }
    if (!isJpegBase64(imageBase64)) return badRequest(res, 'imageBase64 must be a base64 JPEG');

    photos.delete(captureId);
    photos.set(captureId, imageBase64);
    while (photos.size > MAX_PHOTOS) {
      photos.delete(photos.keys().next().value as string);
    }
    res.json({ ok: true, captureId });
  });

  // The phone shows the glasses' new photo from here. Synthetic demo data, same cache as the assessment.
  app.get('/api/wound-photo/:captureId', (req: Request, res: Response) => {
    const id = req.params.captureId;
    const b64 = validCaptureId(id) ? photos.get(id) : undefined;
    if (!b64) return res.status(404).json({ ok: false, error: 'not_found' });
    res.set('Cache-Control', 'no-store').type('image/jpeg').send(Buffer.from(b64, 'base64'));
  });

  // Keep API errors (oversize body, malformed JSON) as JSON instead of Express's HTML page.
  app.use('/api', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = (err as { status?: number })?.status;
    if (status === 413) return res.status(413).json({ ok: false, error: 'payload_too_large' });
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ ok: false, error: 'bad_request' });
    }
    console.error('api error', err instanceof Error ? err.message : 'unknown');
    return res.status(500).json({ ok: false, error: 'internal_error' });
  });
}

export function buildDeepgramUrl(model = process.env.DEEPGRAM_MODEL || 'nova-3'): string {
  const params = new URLSearchParams({
    model,
    encoding: 'linear16',
    sample_rate: '16000',
    interim_results: 'true',
    endpointing: '300',
  });
  for (const term of KEYTERMS) params.append('keyterm', term);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

export const MAX_STT_CLIENTS = 4;

export interface SttProxyOptions {
  /** Max concurrent /ws/stt sockets (each one streams audio to the paid Deepgram key). Default 4. */
  maxClients?: number;
  /** Overrides the Deepgram URL. Tests only. */
  upstreamUrl?: string;
}

/**
 * Proxies browser audio at /ws/stt to Deepgram. Uses noServer and only claims its own path,
 * so another WebSocketServer on the same http.Server (e.g. /ws) keeps working.
 */
export function attachSttProxy(httpServer: http.Server, opts: SttProxyOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  const maxClients = opts.maxClients ?? MAX_STT_CLIENTS;
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy(); // malformed target: never throw out of an upgrade handler
      return;
    }
    if (pathname !== STT_PATH) return;
    if (wss.clients.size >= maxClients) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (client: WebSocket) => bridgeToDeepgram(client, opts));
  return wss;
}

function bridgeToDeepgram(client: WebSocket, opts: SttProxyOptions): void {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    client.close(STT_NO_KEY_CLOSE_CODE, 'stt unavailable: DEEPGRAM_API_KEY not set on server');
    return;
  }

  // The key stays on the server: it is only sent in the upstream handshake header.
  const upstream = new WebSocket(opts.upstreamUrl ?? buildDeepgramUrl(), {
    headers: { Authorization: `Token ${key}` },
  });
  const queued: RawData[] = [];
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stopKeepAlive = () => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = undefined;
  };

  upstream.on('open', () => {
    for (const frame of queued.splice(0)) upstream.send(frame, { binary: true });
    keepAlive = setInterval(() => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send('{"type":"KeepAlive"}');
    }, KEEPALIVE_MS);
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  upstream.on('close', (code) => {
    stopKeepAlive();
    if (client.readyState === WebSocket.OPEN) {
      client.close(code === 1000 ? 1000 : 1011, 'stt upstream closed');
    }
  });

  upstream.on('error', (err) => {
    console.error('deepgram upstream error', err.message);
    stopKeepAlive();
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'stt upstream error');
  });

  client.on('message', (data, isBinary) => {
    if (!isBinary) return; // audio only; control stays on the server
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: true });
    } else if (upstream.readyState === WebSocket.CONNECTING && queued.length < MAX_QUEUED_FRAMES) {
      queued.push(data);
    }
  });

  client.on('close', () => {
    stopKeepAlive();
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send('{"type":"CloseStream"}');
      upstream.close(1000);
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      upstream.terminate();
    }
  });

  client.on('error', () => {
    stopKeepAlive();
    upstream.terminate();
  });
}
