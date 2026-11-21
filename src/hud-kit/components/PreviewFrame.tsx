import type { ReactNode } from 'react';
import type { HudTheme } from './Canvas';

export interface PreviewFrameProps {
  /** ?mirror=1: no desktop controls, canvas at 1x. */
  mirror: boolean;
  zoom: 1 | 2;
  theme: HudTheme;
  onZoomChange: (zoom: 1 | 2) => void;
  onThemeChange: (theme: HudTheme) => void;
  children?: ReactNode;
}

/** Desktop preview chrome: centered on #0B0B0B, 2x zoom via CSS transform, theme toggle. */
export function PreviewFrame({
  mirror,
  zoom,
  theme,
  onZoomChange,
  onThemeChange,
  children,
}: PreviewFrameProps) {
  if (mirror) {
    return <div className="hud-mirror" data-hud="mirror">{children}</div>;
  }
  const frameCls = zoom === 2 ? 'hud-preview__frame hud-preview__frame--2x' : 'hud-preview__frame';
  return (
    <div className="hud-preview">
      <div className="hud-preview__controls">
        <button type="button" aria-pressed={zoom === 2} onClick={() => onZoomChange(zoom === 2 ? 1 : 2)}>
          Preview 2x
        </button>
        <button type="button" onClick={() => onThemeChange(theme === 'green' ? 'color' : 'green')}>
          Theme: {theme}
        </button>
      </div>
      <div className={frameCls}>{children}</div>
    </div>
  );
}
