import { CornerBrackets } from '../../../../hud-kit/components/CornerBrackets';
import { ProgressBar, Steps } from '../../../../hud-kit/components/Progress';
import { StatusStrip } from '../../../../hud-kit/components/StatusStrip';
import { Body, Hero, Hint, Label, Meta } from '../../../../hud-kit/components/Typography';
import { screenCopy, type Role } from '../copy';
import type { GState } from '../stateMachine';

export interface ScreenProps {
  state: GState;
  nowMs: number;
}

const ROLE: Record<Role, typeof Label> = { label: Label, hero: Hero, body: Body, hint: Hint, meta: Meta };

/** Status strip plus the bottom card. The clear zone (x120-520, y90-290) is never rendered into. */
export function Frame({ state, nowMs }: ScreenProps) {
  const copy = screenCopy(state, nowMs);
  const rows = copy.rows.map((r, i) => {
    const Line = ROLE[r.role];
    return (
      <Line key={i} icon={r.icon} iconSize={r.iconPx} aside={r.aside?.text} asideIcon={r.aside?.icon} asideStrong={r.aside?.strong}>
        {r.text}
      </Line>
    );
  });
  const p = copy.progress;
  const footer = p ? (p.kind === 'bar' ? <ProgressBar fraction={p.fraction} /> : <Steps total={p.total} index={p.index} />) : undefined;
  return (
    <div data-screen={state.screen} style={{ display: 'contents' }}>
      <StatusStrip left={copy.left} items={copy.items} dimmed={copy.alert} />
      <CornerBrackets footer={footer} emphasis={copy.alert}>
        {copy.alert ? <div className="hud-tone-alert" style={{ display: 'contents', color: 'var(--hud-alert)' }}>{rows}</div> : rows}
      </CornerBrackets>
    </div>
  );
}
