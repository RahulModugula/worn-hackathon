// Legacy polyfills first: the /glasses page must run on an Android 9 WebView (see docs/COMPAT-PERF.md).
import './polyfills';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './hud-kit/tokens.css';
import './hud-kit/hud-kit.css';
import { GlassesPage } from './pages/GlassesPage';

// Route-level code splitting: /glasses must not download phone, impact or qr code.
const PhonePage = lazy(() => import('./pages/PhonePage').then((m) => ({ default: m.PhonePage })));
const ImpactPage = lazy(() => import('./pages/ImpactPage').then((m) => ({ default: m.ImpactPage })));
const QrPrintPage = lazy(() => import('./apps/bedside-glance/qr/QrPrintPage'));
const StagePage = lazy(() => import('./apps/bedside-glance/stage/StagePage'));

function IndexPage() {
  return (
    <main className="hud-index">
      <h1>Bedside Glance (dev index)</h1>
      <ul>
        <li><Link to="/glasses">/glasses</Link></li>
        <li><Link to="/phone">/phone</Link></li>
        <li><Link to="/qr">/qr</Link></li>
      </ul>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="hud-loading" aria-hidden="true" />}>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/glasses" element={<GlassesPage />} />
          <Route path="/phone" element={<PhonePage />} />
          <Route path="/impact" element={<ImpactPage />} />
          <Route path="/qr" element={<QrPrintPage />} />
          <Route path="/stage" element={<StagePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
