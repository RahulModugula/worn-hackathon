import type { ReactNode } from 'react';

export type HudTheme = 'green' | 'color';

/** The 640x480 black canvas. Everything on the glasses screen sits inside it. */
export function Canvas({
  theme = 'green',
  className,
  children,
}: {
  theme?: HudTheme;
  className?: string;
  children?: ReactNode;
}) {
  const cls = className ? `hud-canvas ${className}` : 'hud-canvas';
  return (
    <div className={cls} data-theme={theme} data-hud="canvas">
      {children}
    </div>
  );
}
