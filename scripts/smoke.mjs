#!/usr/bin/env node
// Production smoke test + fallback drill + display-law geometry. `npm run health` and `npm run ship` run it.
// Builds if needed, starts the production server on a random port WITHOUT any API keys, then drives a real headless Chrome.
// Exit 0 = pass, 1 = fail, 2 = skipped (no Chrome on this machine). Set CHROME_PATH to point at a Chrome/Chromium.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CANVAS, GLASSES_VP, IPHONE_UA, PHONE_VP, ROOT, directorTap, findChrome, launchBrowser, openPage, startServer,
  unexpectedProblems, waitForScreen, waitForText,
} from './e2e/lib.mjs';

// The fallback drill: no keys at all must still work.
delete process.env.GEMINI_API_KEY;
delete process.env.DEEPGRAM_API_KEY;

export const GEOMETRY_PROBE = `(() => {
  const canvas = document.querySelector('[data-hud="canvas"]');
  if (!canvas) return { screen: null, violations: ['no HUD canvas on the page'] };
  const cr = canvas.getBoundingClientRect(); const k = cr.width / 640; const v = [];
  const screen = canvas.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null;
  const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT); const range = document.createRange(); let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; const cs = getComputedStyle(el);
    range.selectNodeContents(n); const r = range.getBoundingClientRect(); if (!r.width && !r.height) continue;
    const x = (r.left - cr.left) / k, y = (r.top - cr.top) / k, w = r.width / k, h = r.height / k;
    const label = JSON.stringify(t.slice(0, 30));
    if (x < 520 && x + w > 120 && y < 290 && y + h > 90) v.push('text in the clear zone (x120-520, y90-290): ' + label);
    if (parseFloat(cs.fontSize) / (1) < 18 - 0.01 && cs.visibility !== 'hidden') v.push('text under 18px (' + cs.fontSize + '): ' + label);
    if (y >= 300 && y + h <= 440 && w > 528.5) v.push('text wider than the 528px card: ' + label);
    let a = el, ok = false;
    while (a && a !== canvas.parentElement) { const s = getComputedStyle(a); if (s.whiteSpace.startsWith('nowrap') && s.textOverflow === 'ellipsis') { ok = true; break; } a = a.parentElement; }
    if (!ok && t.length > 12) v.push('line is not nowrap+ellipsis: ' + label);
  }
  return { screen, violations: v };
})()`;

const fails = [];
const ok = (m) => console.log(`  PASS ${m}`);
const bad = (m) => { fails.push(m); console.log(`  FAIL ${m}`); };

async function main() {
  try { findChrome(); } catch (e) { console.log(`smoke SKIPPED: ${e.message.split('.')[0]}. Set CHROME_PATH to a Chrome or Chromium to enable.`); return 2; }
  console.log('Smoke test (production build, no API keys):');
  const srv = await startServer();
  const browser = await launchBrowser();
  try {
    const h = await fetch(`${srv.base}/api/health`);
    const hb = await h.json().catch(() => ({}));
    h.status === 200 && hb.ok === true ? ok('/api/health is 200 and ok') : bad(`/api/health returned ${h.status}`);

    const jpeg = readFileSync(path.join(ROOT, 'public', 'data', 'wound-fallback.jpg')).toString('base64');
    const t0 = Date.now();
    const r = await fetch(`${srv.base}/api/assess-wound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ captureId: 'smoke-1', imageBase64: jpeg }) });
    const body = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    r.status === 200 && body.source === 'fallback' && body.finding && ms <= 3500
      ? ok(`fallback drill: /api/assess-wound answered with the fallback in ${ms} ms (no keys)`)
      : bad(`fallback drill: status ${r.status}, source "${body.source}", ${ms} ms (need 200, "fallback", <= 3500 ms)`);

    for (const [label, vp, ua] of [['phone 390x844 touch', PHONE_VP, IPHONE_UA], ['glasses 640x480', GLASSES_VP, undefined]]) {
      for (const route of ['/phone', '/glasses']) {
        const { page, problems } = await openPage(browser, { ua, viewport: vp });
        await page.goto(`${srv.base}${route}?session=smoke-${Math.random().toString(36).slice(2, 7)}`, { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
        const real = unexpectedProblems(problems);
        real.length === 0 ? ok(`${route} loads clean at ${label}`) : bad(`${route} at ${label}: ${real.slice(0, 3).map((p) => `${p.kind}: ${p.text}`).join(' | ')}`);
        await page.close();
      }
    }

    const sid = `smoke-${Date.now().toString(36)}`;
    const phone = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
    const glasses = await openPage(browser, { viewport: GLASSES_VP });
    await phone.page.goto(`${srv.base}/phone?director=1&session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForText(phone.page, 'Connected to demo session', { timeout: 15000 });
    await glasses.page.goto(`${srv.base}/glasses?session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForScreen(glasses.page, 'G1', 15000);
    const g1 = await glasses.page.evaluate(GEOMETRY_PROBE);
    g1.violations.length === 0 ? ok(`display law holds on glasses screen ${g1.screen}`) : bad(`display law on ${g1.screen}: ${g1.violations.slice(0, 3).join(' | ')}`);
    await directorTap(phone.page, 'Start Shift');
    await waitForText(phone.page, 'Shift started');
    await directorTap(phone.page, 'Sim Scan Rm 12');
    await waitForText(glasses.page, 'Metformin', { scope: CANVAS, timeout: 5000 });
    const g2 = await glasses.page.evaluate(GEOMETRY_PROBE);
    g2.violations.length === 0 ? ok(`display law holds on glasses screen ${g2.screen} (meds card)`) : bad(`display law on ${g2.screen}: ${g2.violations.slice(0, 3).join(' | ')}`);
    // Prove the probe can fail: plant a 14px line in the clear zone and expect violations.
    await glasses.page.evaluate((c) => {
      const d = document.createElement('div');
      d.textContent = 'planted violation line for the probe';
      d.style.cssText = 'position:absolute;left:200px;top:150px;font-size:14px;white-space:normal';
      document.querySelector(c).appendChild(d);
    }, CANVAS);
    const planted = await glasses.page.evaluate(GEOMETRY_PROBE);
    planted.violations.length >= 2 ? ok('geometry probe self-check: a planted violation is detected') : bad('geometry probe self-check FAILED: planted violation was not detected, so the probe is blind');
    const real = unexpectedProblems([...phone.problems, ...glasses.problems]);
    real.length === 0 ? ok('no console errors or failed requests during the flow') : bad(`flow problems: ${real.slice(0, 3).map((p) => p.text).join(' | ')}`);
  } catch (e) {
    bad(`smoke crashed: ${String(e.message ?? e).split('\n')[0]}`);
  } finally {
    await browser.close().catch(() => {});
    await srv.stop().catch(() => {});
  }
  if (fails.length) { console.error(`\nSMOKE FAILED (${fails.length}). The production build does not behave. Fix the first FAIL line above.`); return 1; }
  console.log('\nsmoke OK');
  return 0;
}

if (/[\\/]smoke\.mjs$/.test(process.argv[1] ?? '')) process.exit(await main());
