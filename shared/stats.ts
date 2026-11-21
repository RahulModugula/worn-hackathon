// Sync health for the Director ("stats" frames). Pure helpers shared by the server and the Director/stage UI.
import type { PeerStats } from './types'

export interface Convergence {
  /** 'converged': every connected peer holds the server version. 'behind': at least one connected peer does not. 'idle': nobody connected. */
  status: 'converged' | 'behind' | 'idle'
  /** Connected peers whose reported state version differs from the server's. */
  behind: PeerStats[]
  /** Peers that are currently offline (they will catch up on reconnect; they are not counted as behind). */
  offline: PeerStats[]
}

export function convergence(peers: readonly PeerStats[], serverVersion: number): Convergence {
  const online = peers.filter((p) => p.offlineSince === null)
  const offline = peers.filter((p) => p.offlineSince !== null)
  // A peer that has not reported yet (v null) is unknown, not behind.
  const behind = online.filter((p) => p.v !== null && p.v !== serverVersion)
  return { status: online.length === 0 ? 'idle' : behind.length > 0 ? 'behind' : 'converged', behind, offline }
}

export interface PingInfo { v?: number; q?: number; rttMs?: number; offlineMs?: number; n?: number }

const int = (x: unknown, max: number): number | undefined =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : undefined

/**
 * Reads the optional fields of a client `{t:'ping', v, q, rtt, offlineMs}` frame. Untrusted: anything out of range,
 * non-finite or of the wrong type is dropped (the ping itself is still answered).
 */
export function parsePing(raw: unknown): PingInfo {
  const o = (raw ?? {}) as Record<string, unknown>
  const out: PingInfo = {}
  const v = int(o.v, 2_000_000_000)
  const q = int(o.q, 10_000)
  const rtt = typeof o.rtt === 'number' && Number.isFinite(o.rtt) && o.rtt >= 0 && o.rtt <= 600_000 ? Math.round(o.rtt) : undefined
  const off = int(o.offlineMs, 7 * 86_400_000)
  const n = int(o.n, 2_000_000_000)
  if (n !== undefined) out.n = n
  if (v !== undefined) out.v = v
  if (q !== undefined) out.q = q
  if (rtt !== undefined) out.rttMs = rtt
  if (off !== undefined) out.offlineMs = off
  return out
}
