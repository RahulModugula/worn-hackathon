import { useEffect, useState, type ReactNode } from 'react';
import type { SessionState } from '../../../../shared/types';
import { conflictText, deviceRows, latencyText, linkView, newestChain, NONE, replayText, type StatsFrame } from './model';

export const STAGE_FOOTER = 'Measured on this network, now. On-glasses latency not measured.';

export interface StageViewProps {
  state: SessionState | null;
  presence: Record<string, number> | undefined;
  stats: StatsFrame | null;
  ownInstances?: readonly string[];
  /** The glasses mirror HUD (640x480, 1x). */
  hud: ReactNode;
  /** Test seam: the clock for the down timer. */
  now?: () => number;
}

/** Runs while the glasses are down: ms since the page first saw presence.glasses === 0, else null. */
function useDownFor(down: boolean, now: () => number): number | null {
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!down) { setSince(null); return; }
    setSince((s) => s ?? now());
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [down, now]);
  return down && since !== null ? Math.max(0, now() - since) : null;
}

const SYNC_TONE = { 'in sync': 'ok', behind: 'warn', offline: 'bad', [NONE]: 'dim' } as const;

/** The projector layout, designed at 1280x720 (the page scales it to any 16:9 screen). Pure of sockets: props in, markup out. */
export function StageView({ state, presence, stats, ownInstances = [], hud, now = Date.now }: StageViewProps) {
  const glassesDown = presence?.glasses === 0;
  const downFor = useDownFor(glassesDown, now);
  const glassesPeer = stats?.peers.filter((p) => p.device === 'glasses').sort((a, b) => b.lastSeenMs - a.lastSeenMs)[0];
  const link = linkView(presence, downFor, glassesPeer?.lastOfflineMs ?? null);
  const rows = deviceRows(stats, ownInstances);
  const chain = newestChain(state?.feed);

  return (
    <div className="st-stage" data-stage="1">
      <header className="st-head">
        <h1 className="st-title">Bedside Glance <span>stage</span></h1>
        <span className={`st-link st-link-${link.linked === null ? 'dim' : link.linked ? 'ok' : 'bad'}`} data-testid="link-chip">
          Glasses: {link.linked === false ? 'Not linked' : link.linked ? 'Linked' : NONE}
        </span>
      </header>

      <div className="st-body">
        <div className="st-left">
          <div className="st-hud" data-testid="hud">{hud}</div>
          <section className="st-chain" aria-label="Newest event">
            {chain ? (
              <>
                <h2 className="st-chain-title">{chain.title}</h2>
                <ol className="st-steps">
                  {chain.steps.map((s, i) => <li key={`${i}:${s}`}>{s}</li>)}
                </ol>
              </>
            ) : (
              <h2 className="st-chain-title st-dim">No events yet {NONE}</h2>
            )}
          </section>
        </div>

        <aside className="st-rail" aria-label="Sync health">
          <section className="st-panel" aria-label="Devices">
            <h2>Devices</h2>
            {rows.length === 0 ? (
              <p className="st-val st-dim" data-testid="devices-empty">{NONE}</p>
            ) : (
              <table className="st-table">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.role}</th>
                      <td>{r.rtt}</td>
                      <td>{r.version}</td>
                      <td className={`st-sync st-sync-${SYNC_TONE[r.sync]}`}>{r.sync}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="st-panel" aria-label="Link">
            <h2>Link</h2>
            <p className={`st-val ${link.linked === false ? 'st-bad' : link.linked === null ? 'st-dim' : ''}`} data-testid="link-text">{link.text}</p>
          </section>
          <section className="st-panel" aria-label="Replay">
            <h2>Replay</h2>
            <p className={`st-val ${replayText(state?.telemetry, stats) === NONE ? 'st-dim' : ''}`} data-testid="replay-text">{replayText(state?.telemetry, stats)}</p>
          </section>
          <section className="st-panel" aria-label="Conflicts">
            <h2>Conflicts</h2>
            <p className={`st-val ${conflictText(state?.feed) === NONE ? 'st-dim' : ''}`} data-testid="conflict-text">{conflictText(state?.feed)}</p>
          </section>
          <section className="st-panel" aria-label="Latency">
            <h2>Latency, done to server ack</h2>
            <p className={`st-val ${latencyText(state?.telemetry) === NONE ? 'st-dim' : ''}`} data-testid="latency-text">{latencyText(state?.telemetry)}</p>
          </section>
        </aside>
      </div>

      <footer className="st-foot">{STAGE_FOOTER}</footer>
    </div>
  );
}
