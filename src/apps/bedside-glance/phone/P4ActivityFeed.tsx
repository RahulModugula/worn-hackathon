import { useState } from 'react';
import type { FeedEntry, SessionEvent } from '../../../../shared/types';
import { chainFor, deviceLabel, eventLabel } from './model';
import { Icon, type IconName } from './Icon';
import { EmptyState, VerificationSteps } from './ui';

interface Props {
  events: SessionEvent[];
  labelFor: (atMs: number) => string;
  /** Server feed with the verification chain per event (matched by seq). */
  feed?: FeedEntry[];
}

const REAL_TYPES = new Set([
  'LOG_MED', 'UNDO_LAST_MED', 'WOUND_CAPTURED', 'WOUND_SAVE', 'WOUND_SEND', 'WOUND_RETRY_UPLOAD', 'DR_REPLY',
  'WOUND_SET_DRESSING', 'ALLERGY_ACK', 'HANDOFF_OFFER', 'HANDOFF_READBACK', 'HANDOFF_ACCEPT',
]);

const DEVICE_ICON: Record<string, IconName> = { glasses: 'glasses', phone: 'phone', director: 'bolt' };

/** "1:45 PM" -> "1 PM hour". Events without a demo time (before the shift starts) group as "Earlier". */
function groupOf(time: string): string {
  const m = /^(\d{1,2}):\d{2} (AM|PM)$/.exec(time);
  return m ? `${m[1]} ${m[2]}` : 'Earlier';
}

/** Live timeline, newest first, grouped by hour of the demo clock. Capped so the phone stays light. */
export function P4ActivityFeed({ events, labelFor, feed }: Props) {
  const [showDemo, setShowDemo] = useState(false);
  // Director (simulated) events are rehearsal noise: hidden unless the presenter asks for them.
  // A phone with the Director capability is stamped "director" by the server, so a real med log or photo action from it
  // still counts as real: only scenario controls (start, sim scan, SIM_*) are demo events.
  const isDemo = (e: SessionEvent) => deviceLabel({ by: e.device }) === 'director' && !REAL_TYPES.has(e.type);
  const demoCount = events.filter(isDemo).length;
  const shown = showDemo ? events : events.filter(e => !isDemo(e));
  const recent = shown.slice(-30).reverse();
  const groups: { title: string; items: { e: SessionEvent; time: string }[] }[] = [];
  for (const e of recent) {
    const time = labelFor(e.atMs);
    const title = groupOf(time);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push({ e, time });
    else groups.push({ title, items: [{ e, time }] });
  }

  return (
    <section className="ph-view ph-feed" aria-labelledby="p4-title">
      <div className="ph-head-block">
        <h1 id="p4-title" className="ph-title">Activity</h1>
        <p className="ph-muted">{shown.length} {shown.length === 1 ? 'event' : 'events'} this shift</p>
      </div>
      {demoCount > 0 && (
        <button type="button" className="ph-link-btn" aria-pressed={showDemo} onClick={() => setShowDemo(v => !v)}>
          {showDemo ? 'Hide demo events' : 'Show demo events'} ({demoCount})
        </button>
      )}
      {recent.length === 0 ? (
        <EmptyState icon="activity" title="Nothing yet">Scans, med logs and photos show up here as they happen.</EmptyState>
      ) : (
        groups.map(g => (
          <div key={g.title} className="ph-group">
            <h2 className="ph-h2 ph-section-title">{g.title}</h2>
            <ol className="ph-timeline">
              {g.items.map(({ e, time }, i) => {
                const chain = chainFor(feed, e.seq);
                const entry = feed?.find(f => f.seq === e.seq);
                const detail = entry && (entry.kind === 'handoff_offered' || entry.kind === 'handoff_accepted') ? entry.label : undefined;
                const device = isDemo(e) ? 'director' : deviceLabel({ by: e.device }) === 'director' ? 'phone' : deviceLabel({ by: e.device });
                return (
                  <li key={`${e.seq}-${i}`} className="ph-event">
                    <span className={`ph-event-icon ph-event-${device}`}><Icon name={DEVICE_ICON[device] ?? 'phone'} size={20} /></span>
                    <div className="ph-event-body">
                      <div className="ph-event-top">
                        <span className="ph-strong">{eventLabel(e.type)}</span>
                        <span className="ph-muted ph-event-time">{time}</span>
                      </div>
                      {detail && <span className="ph-strong" data-testid="feed-label">{detail}</span>}
                      <span className="ph-muted">From the {device}</span>
                      {chain.length > 0 && <VerificationSteps steps={chain} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
