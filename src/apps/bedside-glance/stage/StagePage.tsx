import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../phone/tokens.css';
import './stage.css';
import { ErrorBoundary } from '../ErrorBoundary';
import { GlassesApp } from '../glasses/GlassesApp';
import { StageView } from './StageView';
import { useStageFeed } from './useStageFeed';

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const W = 1280;
const H = 720;

/** Scale factor that fits the 1280x720 design into the window (a 1920x1080 projector gets 1.5). */
function useFit(): number {
  const read = () => (typeof window === 'undefined' ? 1 : Math.min(window.innerWidth / W, window.innerHeight / H) || 1);
  const [k, setK] = useState(read);
  useEffect(() => {
    const on = () => setK(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return k;
}

/**
 * /stage: the projector page. Left, the glasses mirror HUD at 1x; right, the sync health rail. It connects as a read-only
 * director (`?key=` when the server sets DIRECTOR_KEY). Lazy route: never part of the /glasses bundle.
 */
export default function StagePage() {
  const [params] = useSearchParams();
  const raw = params.get('session') ?? 'demo';
  const sessionId = SESSION_ID.test(raw) ? raw : 'demo';
  const feed = useStageFeed(sessionId, params.get('key') ?? undefined);
  const k = useFit();
  return (
    <ErrorBoundary>
      <div className="ph-app st-root">
        <div className="st-fit" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${k})` }}>
          <StageView
            state={feed.state}
            presence={feed.presence}
            stats={feed.stats}
            ownInstances={feed.ownInstances}
            hud={<GlassesApp mirror strictLink sessionId={sessionId} theme="green" zoom={1} />}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}
