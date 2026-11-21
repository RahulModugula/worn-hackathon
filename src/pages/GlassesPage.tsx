import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { HudTheme } from '../hud-kit/components/Canvas';
import { ErrorBoundary } from '../apps/bedside-glance/ErrorBoundary';
import { GlassesApp } from '../apps/bedside-glance/glasses/GlassesApp';

/** /glasses (desktop preview or M6) and /glasses?mirror=1 (read-only stage projection). */
export function GlassesPage() {
  const [params] = useSearchParams();
  const mirror = params.get('mirror') === '1';
  const sessionId = params.get('session') || 'demo';
  const [theme, setTheme] = useState<HudTheme>(params.get('theme') === 'color' ? 'color' : 'green');
  const [zoom, setZoom] = useState<1 | 2>(1);

  return (
    <ErrorBoundary>
    <GlassesApp
      mirror={mirror}
      debug={params.get('debug') === '1'}
      sessionId={sessionId}
      theme={theme}
      zoom={mirror ? 1 : zoom}
      onZoomChange={setZoom}
      onThemeChange={setTheme}
    />
    </ErrorBoundary>
  );
}
