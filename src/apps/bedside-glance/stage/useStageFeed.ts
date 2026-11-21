import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../../../../shared/types';
import { getInstanceId, makeUuid } from '../../../hud-kit/sync/useSession';
import type { StatsFrame } from './model';

export interface StageFeed {
  state: SessionState | null;
  presence: Record<string, number> | undefined;
  stats: StatsFrame | null;
  connected: boolean;
  /** Socket instances that belong to this projector (this one plus the mirror HUD's): hidden from the device list. */
  ownInstances: string[];
}

type WsCtor = new (url: string) => {
  onopen: (() => void) | null; onclose: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: (() => void) | null; close(): void;
};

export function stageSocketUrl(sessionId: string, instance: string, key: string | undefined, loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws?session=${encodeURIComponent(sessionId)}&device=director&director=1&instance=${encodeURIComponent(instance)}${key ? `&key=${encodeURIComponent(key)}` : ''}`;
}

/**
 * Read-only director socket for the projector: state, presence and the director-only `stats` frames. It never sends an action
 * (the mirror HUD beside it uses its own socket), and it reconnects with a capped backoff. Frames are untrusted: only the
 * fields used are read, with shape checks.
 */
export function useStageFeed(sessionId: string, key?: string, WebSocketImpl?: WsCtor): StageFeed {
  const instance = useRef<string>('');
  if (!instance.current) instance.current = makeUuid();
  const [state, setState] = useState<SessionState | null>(null);
  const [presence, setPresence] = useState<Record<string, number> | undefined>(undefined);
  const [stats, setStats] = useState<StatsFrame | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const Ctor = WebSocketImpl ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sock: InstanceType<WsCtor> | null = null;
    const open = () => {
      if (stopped) return;
      let s: InstanceType<WsCtor>;
      try { s = new Ctor(stageSocketUrl(sessionId, instance.current, key)); } catch { return; }
      sock = s;
      s.onopen = () => { attempt = 0; setConnected(true); };
      s.onmessage = (e) => {
        let m: { t?: unknown; state?: unknown; presence?: unknown; peers?: unknown; serverVersion?: unknown };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m === null || typeof m !== 'object') return;
        if (m.t === 'state' && m.state && typeof m.state === 'object') setState(m.state as SessionState);
        else if (m.t === 'presence' && m.presence && typeof m.presence === 'object') setPresence(m.presence as Record<string, number>);
        else if (m.t === 'stats' && Array.isArray(m.peers) && typeof m.serverVersion === 'number') setStats({ peers: m.peers, serverVersion: m.serverVersion });      };
      s.onerror = () => { /* close follows */ };
      s.onclose = () => {
        if (sock !== s) return;
        sock = null; setConnected(false); setPresence(undefined);
        if (!stopped) timer = setTimeout(open, Math.min(500 * 2 ** attempt++, 5000));
      };
    };
    open();
    return () => { stopped = true; if (timer) clearTimeout(timer); const s = sock; sock = null; try { s?.close(); } catch { /* already closed */ } };
  }, [sessionId, key, WebSocketImpl]);

  return { state, presence, stats, connected, ownInstances: [instance.current, getInstanceId()] };
}
