// Pure derivations for the /stage projector page. No React, no network. Every value is MEASURED or the dash '-':
// a target, a guess or a number from another session never appears here.
import type { FeedEntry, PeerStats, SessionState } from '../../../../shared/types';
import { convergence } from '../../../../shared/stats';

/** Shown for anything not measured yet. */
export const NONE = '-';

export interface StatsFrame { peers: PeerStats[]; serverVersion: number }

export type SyncLabel = 'in sync' | 'behind' | 'offline' | typeof NONE;
export interface DeviceRow { key: string; role: string; rtt: string; version: string; sync: SyncLabel }

const ROLE: Record<string, string> = { glasses: 'Glasses', phone: 'Phone', director: 'Director' };

/** One row per peer. `hide` lists this stage's own socket instances so the projector does not list itself. */
export function deviceRows(stats: StatsFrame | null, hide: readonly string[] = []): DeviceRow[] {
  if (!stats) return [];
  const { behind } = convergence(stats.peers, stats.serverVersion);
  return stats.peers
    .filter((p) => !(p.instance && hide.includes(p.instance)))
    .map((p, i) => {
      const offline = p.offlineSince !== null;
      const sync: SyncLabel = offline ? 'offline' : p.v === null ? NONE : behind.includes(p) ? 'behind' : 'in sync';
      return {
        key: `${p.device}:${p.instance ?? i}`,
        role: ROLE[p.device] ?? p.device,
        rtt: p.rttMs === null || offline ? NONE : `${p.rttMs} ms`,
        version: p.v === null ? NONE : `v${p.v}`,
        sync,
      };
    });
}

const samples = (t: SessionState['telemetry'], metric: 'doneToAckMs' | 'outboxQueuedMs'): number[] =>
  (t?.[metric] ?? []).filter((x) => Number.isFinite(x));

/** Lower median, the same rule the glasses debug bar and the phone preflight use. */
export function p50(xs: readonly number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * '{n} replayed · queued {x} s · 0 lost'. n = actions that waited in an outbox and were flushed (telemetry), x = the longest
 * wait, 'lost' is stated only when every connected peer reports an empty outbox and the same version as the server.
 */
export function replayText(telemetry: SessionState['telemetry'], stats: StatsFrame | null): string {
  const q = samples(telemetry, 'outboxQueuedMs');
  if (q.length === 0) return NONE;
  const longest = Math.max(...q);
  let tail = 'lost -';
  if (stats) {
    const online = stats.peers.filter((p) => p.offlineSince === null);
    const waiting = online.reduce((n, p) => n + p.q, 0);
    if (waiting > 0) tail = `${waiting} still queued`;
    else if (convergence(stats.peers, stats.serverVersion).status === 'converged') tail = '0 lost';
  }
  return `${q.length} replayed · queued ${(longest / 1000).toFixed(1)} s · ${tail}`;
}

/** 'last {x} ms · p50 {y} ms · n={n}' from the done-to-server-ack samples, or '-'. Server ack, not on-glasses latency. */
export function latencyText(telemetry: SessionState['telemetry']): string {
  const xs = samples(telemetry, 'doneToAckMs');
  if (xs.length === 0) return NONE;
  return `last ${xs[xs.length - 1]} ms · p50 ${p50(xs)} ms · n=${xs.length}`;
}

/** First write wins: the device that logged the newest given dose, from the feed. '-' when nothing was given. */
export function conflictText(feed: SessionState['feed']): string {
  const e = [...(feed ?? [])].reverse().find((f) => f.kind === 'med_given');
  if (!e) return NONE;
  return `First write wins: ${e.device} logged ${e.medName ?? 'a dose'} at ${e.timeLabel}`;
}

export interface LinkView { linked: boolean | null; text: string }

/**
 * `presence.glasses === 0` means no glasses socket: 'Not linked', plus how long it has been down when known.
 * Unknown presence (no frame yet) is '-', never 'Linked'.
 */
export function linkView(presence: Record<string, number> | undefined, downForMs: number | null, lastOutageMs: number | null): LinkView {
  const g = presence?.glasses;
  if (g === undefined) return { linked: null, text: NONE };
  if (g === 0) return { linked: false, text: downForMs === null ? 'Not linked' : `Not linked · down ${(downForMs / 1000).toFixed(0)} s` };
  return { linked: true, text: lastOutageMs ? `Linked · last outage ${(lastOutageMs / 1000).toFixed(1)} s` : 'Linked' };
}

const KIND: Record<string, string> = {
  med_given: 'Dose logged', med_undone: 'Dose undone', wound_captured: 'Wound photo', wound_saved: 'Wound saved', wound_sent: 'Wound sent',
  wound_dressing: 'Dressing set', dr_reply: 'Doctor reply', allergy_ack: 'Allergy acknowledged', handoff_offered: 'Handoff offered', handoff_accepted: 'Handoff accepted',
};

export interface ChainView { title: string; steps: string[] }

/** The newest feed entry with its verification steps, or null. */
export function newestChain(feed: SessionState['feed']): ChainView | null {
  const e: FeedEntry | undefined = feed?.[feed.length - 1];
  if (!e) return null;
  const what = e.label ?? [e.medName, e.room ? `Rm ${e.room}` : e.patientName].filter(Boolean).join(' · ');
  return { title: `${KIND[e.kind] ?? e.kind}${what ? ` · ${what}` : ''} · ${e.timeLabel}`, steps: e.chain };
}
