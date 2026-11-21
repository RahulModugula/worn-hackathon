import type { ReactNode } from 'react';

/** Bottom card: x40-600, y300-440, four short 2px corner ticks (24px and 3px when emphasis is set), padding 8px/16px (528px inner width). */
export function CornerBrackets({ children, footer, emphasis }: { children?: ReactNode; footer?: ReactNode; emphasis?: boolean }) {
  const cls = ['hud-card', footer ? 'hud-card--progress' : '', emphasis ? 'hud-card--emphasis' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-hud="card">
      <span className="hud-bracket hud-bracket--tl" aria-hidden="true" />
      <span className="hud-bracket hud-bracket--tr" aria-hidden="true" />
      <span className="hud-bracket hud-bracket--bl" aria-hidden="true" />
      <span className="hud-bracket hud-bracket--br" aria-hidden="true" />
      <div className="hud-card__content">{children}</div>
      {footer ? <div className="hud-card__footer">{footer}</div> : null}
    </div>
  );
}
