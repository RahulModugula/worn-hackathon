import type { ReactNode } from 'react';
import { Icon, type HudIconName } from './Icon';

export interface StatusItem {
  key: string;
  text: string;
  icon?: HudIconName;
  /** 75% luminance (a live or warning state) instead of the 60% metadata level. */
  strong?: boolean;
}

/** Top strip: x40-600, y0-80. Left: identity text. Right: icon + word items (connection, live input, clock). dimmed drops the whole strip to 50% while an alert owns the card. */
export function StatusStrip({ left, items, dimmed }: { left?: ReactNode; items?: StatusItem[]; dimmed?: boolean }) {
  return (
    <div className={dimmed ? 'hud-status hud-status--dim' : 'hud-status'} data-hud="status-strip">
      <div className="hud-text hud-status__left">{left}</div>
      <div className="hud-status__right">
        {(items ?? []).map((it) => (
          <div key={it.key} className={it.strong ? 'hud-status__item hud-status__item--strong' : 'hud-status__item'} data-item={it.key}>
            {it.icon ? <Icon name={it.icon} /> : null}
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
