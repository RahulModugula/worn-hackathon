// Screenshot pipeline: drives the real app (production build + real WebSocket) and writes docs/img/*.png.
// Run with `npm run screenshots`. Needs system Chrome (CHROME_PATH or a default install). No browser download.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CANVAS, GLASSES_VP, IPHONE_UA, PHONE_VP, ROOT, clickButton, clickMedRow, closeDrawer, directorTap, ensureDrawerOpen,
  hidePreviewChrome, launchBrowser, openPage, pngSize, setDsf, sleep, startServer, waitForScreen, waitForText,
} from './e2e/lib.mjs';

const IMG = path.join(ROOT, 'docs', 'img');
const FRAMES = path.join(IMG, 'demo-frames');
const MAX_BYTES = 500 * 1024;
const WANT_BYTES = 300 * 1024;
const report = [];

/**
 * Element (or page) screenshot at the preferred deviceScaleFactor. If the file is over 300 KB, retry at 1.5;
 * keep the smallest result and warn if it is still over 500 KB. Only PNG via puppeteer `type: 'png'`.
 */
async function shot(page, target, name, { dsf = 2, fallbackDsf = 1.5 } = {}) {
  const file = path.join(IMG, `${name}.png`);
  await page.bringToFront();
  await setDsf(page, dsf);
  let size = await (async () => { await target.screenshot({ path: file, type: 'png' }); return statSync(file).size; })();
  let usedDsf = dsf;
  if (size > WANT_BYTES && fallbackDsf < dsf) {
    await setDsf(page, fallbackDsf);
    await target.screenshot({ path: file, type: 'png' });
    const small = statSync(file).size;
    if (small < size) { size = small; usedDsf = fallbackDsf; }
    else await setDsf(page, dsf); // keep the larger, higher-quality capture
  }
  const dims = pngSize(file);
  const kb = (size / 1024).toFixed(0);
  report.push({ name: `${name}.png`, bytes: size, dims: `${dims.width}x${dims.height}`, dsf: usedDsf, warn: size > MAX_BYTES ? 'over 500 KB' : '' });
  console.log(`  ${name}.png  ${dims.width}x${dims.height}  dsf ${usedDsf}  ${kb} KB${size > MAX_BYTES ? '  OVER 500 KB' : ''}`);
  return file;
}

/** Glasses canvas screenshot: 640x480 at dsf 2, preview chrome hidden for the capture only. */
async function glassesShot(page, name) {
  const undo = await hidePreviewChrome(page);
  await sleep(250);
  const el = await page.$(CANVAS);
  await shot(page, el, name, { dsf: 2, fallbackDsf: 1.5 });
  await undo();
}

async function phoneShot(page, name, fn) {
  if (fn) await fn();
  await sleep(300);
  await shot(page, page, name, { dsf: 3, fallbackDsf: 2 });
}

/** Opens the phone Director page and the glasses page on one session. */
async function openPair(browser, base, sid) {
  const phone = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
  const glasses = await openPage(browser, { viewport: GLASSES_VP });
  await phone.page.goto(`${base}/phone?director=1&session=${sid}`, { waitUntil: 'domcontentloaded' });
  await waitForText(phone.page, 'Connected to demo session', { timeout: 15000 });
  await glasses.page.goto(`${base}/glasses?session=${sid}`, { waitUntil: 'domcontentloaded' });
  await waitForScreen(glasses.page, 'G1', 15000);
  return { P: phone.page, G: glasses.page, close: () => Promise.all([phone.page.close(), glasses.page.close()]).catch(() => {}) };
}

async function glassesWithTheme(G, from = 'green') {
  // The preview's own theme toggle (real click), not a URL switch. The button label names the CURRENT theme.
  await clickButton(G, '.hud-preview__controls', 'Theme: ' + from, { contains: true });
}

async function glassCaptures(browser, base) {
  console.log('Glasses scenes (640x480 @2x):');
  const sid = `shots-a-${Date.now().toString(36)}`;
  const { P, G, close } = await openPair(browser, base, sid);
  try {
    await glassesShot(G, 'hud-g1-idle');
    await G.keyboard.press('2'); // desktop shortcut: jump to G2 (dwell in progress)
    await waitForScreen(G, 'G2', 3000);
    await glassesShot(G, 'hud-g2-scanning');
    await G.keyboard.press('1');

    await directorTap(P, 'Start Shift');
    await waitForText(P, 'Shift started');
    await directorTap(P, 'Sim Scan Rm 12');
    await waitForText(G, 'Maria', { scope: CANVAS });
    await waitForText(G, 'Metformin', { scope: CANVAS });
    await sleep(300);
    await glassesShot(G, 'hud-g4-meds-card');
    await glassesWithTheme(G);
    await sleep(300);
    await glassesShot(G, 'hud-g4-meds-card-color');
    await glassesWithTheme(G, 'color'); // back to green

    // G5 fades after 3 s: capture immediately.
    await directorTap(P, 'Voice: Done');
    await waitForScreen(G, 'G5', 5000);
    await glassesShot(G, 'hud-g5-med-logged');

    await sleep(3500); // let G5 fade back to G4
    await directorTap(P, 'Trigger: Pain');
    await waitForScreen(G, 'G6', 5000);
    await glassesShot(G, 'hud-g6-prn');

    await directorTap(P, 'Trigger: Wound');
    await waitForScreen(G, 'G7', 5000);
    await glassesShot(G, 'hud-g7-wound-prompt');

    await directorTap(P, 'Capture Wound Photo');
    await waitForScreen(G, 'G8', 20000);
    await sleep(400);
    await glassesShot(G, 'hud-g8-wound-assessment');

    await directorTap(P, 'Add Conflicting Order');
    await waitForScreen(G, 'ALLERGY', 5000);
    await sleep(300);
    await glassesShot(G, 'hud-critical-allergy');
    await glassesWithTheme(G); // colour mode: the alert is red, ticks and diamond unchanged
    await sleep(300);
    await glassesShot(G, 'hud-critical-allergy-color');
    await glassesWithTheme(G, 'color'); // back to green
  } finally {
    await close();
  }
  return sid;
}

async function conflictBanner(browser, base) {
  console.log('Conflict banner (offline log, then glasses done):');
  const sid = `shots-b-${Date.now().toString(36)}`;
  const { P, G, close } = await openPair(browser, base, sid);
  try {
    await directorTap(P, 'Start Shift');
    await waitForText(P, 'Shift started');
    await directorTap(P, 'Sim Scan Rm 12');
    await waitForText(G, 'Metformin', { scope: CANVAS });
    await clickButton(G, '[data-desktop-controls]', 'Force Offline');
    await waitForText(G, 'Not linked', { scope: CANVAS });
    await closeDrawer(P);
    await clickMedRow(P, 'Metformin');
    await sleep(400);
    await G.keyboard.press('d'); // glasses log while offline: queued in the outbox
    await sleep(300);
    await clickButton(G, '[data-desktop-controls]', 'Force Offline'); // reconnect: outbox flushes, server refuses
    await G.waitForFunction((c) => (document.querySelector(c)?.textContent ?? '').includes('Already given'), { timeout: 8000 }, CANVAS).catch(() => {});
    await sleep(300);
    await glassesShot(G, 'hud-conflict-banner');
  } finally {
    await close();
  }
}

async function phoneCaptures(browser, base, sidA) {
  console.log('Phone scenes (390x844 @3x, iPhone UA):');
  // Session with the shift started and Maria scanned, drawer closed.
  const sid = `shots-c-${Date.now().toString(36)}`;
  const { P, G, close } = await openPair(browser, base, sid);
  try {
    await directorTap(P, 'Start Shift');
    await waitForText(P, 'Shift started');
    await closeDrawer(P);
    await phoneShot(P, 'phone-p1-my-shift');

    await ensureDrawerOpen(P); await closeDrawer(P);
    await directorTap(P, 'Sim Scan Rm 12');
    await waitForText(G, 'Maria', { scope: CANVAS });
    await P.waitForFunction(() => !!document.querySelector('.ph-med'), { timeout: 5000 });
    await closeDrawer(P);
    await phoneShot(P, 'phone-p2-patient');

    // P4 activity feed: log Metformin from the phone first so a real med event with its verification steps exists,
    // then capture the full viewport (tab bar included).
    await clickMedRow(P, 'Metformin');
    await sleep(500);
    await clickButton(P, '.ph-tabbar', 'Activity', { contains: true }).catch(() => {}); // Activity is a tab now
    await P.waitForSelector('.ph-steps-chain', { timeout: 5000 }).catch(() => {});
    await sleep(300);
    await P.evaluate(() => window.scrollTo(0, 0));
    await phoneShot(P, 'phone-p4-activity-feed');
    await clickButton(P, '.ph-tabbar', 'Patient', { contains: true }).catch(() => {});

    // P3 wound review: photo, assessment, side-by-side.
    await directorTap(P, 'Trigger: Wound');
    await sleep(300);
    await directorTap(P, 'Capture Wound Photo');
    await waitForText(G, 'Maria', { scope: CANVAS });
    await P.waitForFunction(() => !!document.querySelector('.ph-view[aria-labelledby="p3-title"]'), { timeout: 20000 });
    await closeDrawer(P); // the Director sheet was opened for the wound taps and would cover the review
    await P.waitForFunction(() => !document.querySelector('.ph-undo'), { timeout: 20000 }).catch(() => {}); // earlier Undo toast would cover the review
    await sleep(500);
    await phoneShot(P, 'phone-p3-wound-review');
    await P.evaluate(() => window.scrollTo(0, 0));
  } finally {
    await close();
  }

  // Director drawer with the preflight panel, opened on load.
  const dsid = `shots-d-${Date.now().toString(36)}`;
  const d = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
  try {
    await d.page.goto(`${base}/phone?director=1&session=${dsid}`, { waitUntil: 'domcontentloaded' });
    await waitForText(d.page, 'Director', { timeout: 15000 });
    await sleep(500);
    await phoneShot(d.page, 'phone-director-drawer');
  } finally { await d.page.close().catch(() => {}); }

  // Scan & Talk (glasses off).
  const ssid = `shots-e-${Date.now().toString(36)}`;
  const s = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
  try {
    await s.page.goto(`${base}/phone?scan=1&session=${ssid}`, { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await phoneShot(s.page, 'phone-scan-talk');
  } finally { await s.page.close().catch(() => {}); }
  void sidA;
}

async function mirrorCapture(browser, base) {
  console.log('Stage mirror (640x480 @2x):');
  const sid = `shots-f-${Date.now().toString(36)}`;
  const { P, G, close } = await openPair(browser, base, sid);
  try {
    await directorTap(P, 'Start Shift');
    await waitForText(P, 'Shift started');
    await directorTap(P, 'Sim Scan Rm 12');
    await waitForText(G, 'Maria', { scope: CANVAS });
    await sleep(300);
    const m = await openPage(browser, { viewport: GLASSES_VP });
    try {
      await m.page.goto(`${base}/glasses?mirror=1&session=${sid}`, { waitUntil: 'domcontentloaded' });
      await m.page.waitForFunction(() => (document.querySelector('[data-hud="canvas"]')?.textContent ?? '').includes('Maria'), { timeout: 10000 });
      await sleep(300);
      const el = await m.page.$(CANVAS);
      await shot(m.page, el, 'hud-mirror', { dsf: 2, fallbackDsf: 1.5 });
    } finally { await m.page.close().catch(() => {}); }
  } finally { await close(); }
}

async function webCaptures(browser, base) {
  console.log('Web pages:');
  const imp = await openPage(browser, { viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
  await imp.page.goto(`${base}/impact`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await shot(imp.page, imp.page, 'impact-1280x720', { dsf: 1, fallbackDsf: 1 });
  await imp.page.setViewport({ ...PHONE_VP });
  await sleep(300);
  await shot(imp.page, imp.page, 'impact-390x844', { dsf: 2, fallbackDsf: 1.5 });
  await imp.page.close();

  const qr = await openPage(browser, { viewport: { width: 794, height: 1123, deviceScaleFactor: 1 } });
  await qr.page.goto(`${base}/qr`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await shot(qr.page, qr.page, 'qr-print-794x1123', { dsf: 1, fallbackDsf: 1 });
  await qr.page.close();
}

/** Composite hero: a plain HTML page of six glasses captures in a 3x2 grid, then screenshotted. */
async function heroImage(browser) {
  console.log('Hero composite:');
  const items = [
    ['hud-g1-idle.png', 'G1 idle'], ['hud-g2-scanning.png', 'G2 scanning'], ['hud-g4-meds-card.png', 'G4 meds card (Maria, Rm 12)'],
    ['hud-g5-med-logged.png', 'G5 med logged'], ['hud-g6-prn.png', 'G6 PRN'], ['hud-critical-allergy.png', 'Critical allergy'],
  ];
  const cells = items.map(([f, cap]) => `<figure><img src="${pathToFileURL(path.join(IMG, f)).href}" alt=""><figcaption>${cap}</figcaption></figure>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0B0B0B;color:#fff;font:16px/1.3 -apple-system,Helvetica,Arial,sans-serif}
    .wrap{padding:40px;width:1800px;box-sizing:border-box}
    h1{margin:0 0 6px;font-size:30px;font-weight:600} .sub{margin:0 0 28px;color:#9a9a9a;font-size:16px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
    figure{margin:0} img{width:100%;display:block;border:1px solid #222}
    figcaption{margin-top:8px;color:#b8b8b8;font-size:15px;letter-spacing:.02em}
  </style></head><body><div class="wrap"><h1>Bedside Glance on the M6 glasses</h1>
  <p class="sub">Real captures from the production build. 640x480 canvas, green HUD.</p>
  <div class="grid">${cells}</div></div></body></html>`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bg-hero-'));
  const htmlFile = path.join(dir, 'hero.html');
  writeFileSync(htmlFile, html);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1800, height: 800, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    const wrap = await page.$('.wrap');
    await shot(page, wrap, 'hero-hud', { dsf: 1, fallbackDsf: 1 });
  } finally {
    await page.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Recorded flow: ~90 s demo, 12 glasses frames at 7.5 s intervals, then an ffmpeg GIF if ffmpeg exists. */
async function demoFlow(browser, base) {
  console.log('Recorded demo flow (~90 s, 12 frames):');
  mkdirSync(FRAMES, { recursive: true });
  for (const f of readdirSync(FRAMES)) if (f.endsWith('.png')) rmSync(path.join(FRAMES, f));
  const sid = `shots-demo-${Date.now().toString(36)}`;
  const { P, G, close } = await openPair(browser, base, sid);
  const started = Date.now();
  const FRAME_MS = 7500;
  let frames = 0;
  // Frames are taken between steps, never in parallel with them: a background tab cannot be screenshotted.
  const tick = async () => {
    while (frames < 12 && Date.now() >= started + frames * FRAME_MS) {
      await G.bringToFront();
      const el = await G.$(CANVAS);
      if (el) await el.screenshot({ path: path.join(FRAMES, `frame-${String(frames + 1).padStart(2, '0')}.png`), type: 'png' });
      frames++;
    }
  };
  const wait = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { await sleep(Math.min(250, end - Date.now())); await tick(); }
  };
  try {
    await tick();
    await wait(1000);
    await directorTap(P, 'Start Shift');
    await directorTap(P, 'Sim Scan Rm 12');
    await waitForText(G, 'Metformin', { scope: CANVAS });
    await wait(6000);
    await directorTap(P, 'Voice: Done');
    await wait(7000);
    await directorTap(P, 'Trigger: Pain');
    await wait(12000);
    await directorTap(P, 'Trigger: Wound');
    await wait(8000);
    await directorTap(P, 'Capture Wound Photo');
    await wait(14000);
    await directorTap(P, 'Add Conflicting Order');
    await wait(14000);
    while (frames < 12) { await sleep(200); await tick(); }
  } finally {
    await close();
  }
  console.log(`  frames: ${frames} in ${FRAMES}`);
  const ff = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (ff.status !== 0 || ff.error) {
    console.log('  ffmpeg not found: skipping docs/img/demo.gif (frames kept in demo-frames/)');
    return;
  }
  const out = path.join(IMG, 'demo.gif');
  const pal = path.join(FRAMES, 'palette.png');
  const input = path.join(FRAMES, 'frame-%02d.png');
  spawnSync('ffmpeg', ['-y', '-framerate', '2', '-i', input, '-vf', 'palettegen', pal], { stdio: 'ignore' });
  const r = spawnSync('ffmpeg', ['-y', '-framerate', '2', '-i', input, '-i', pal, '-lavfi', 'paletteuse', out], { stdio: 'ignore' });
  rmSync(pal, { force: true });
  if (r.status === 0) console.log(`  demo.gif ${(statSync(out).size / 1024).toFixed(0)} KB`);
  else console.log('  ffmpeg failed to write demo.gif');
}

async function main() {
  mkdirSync(IMG, { recursive: true });
  const srv = await startServer();
  const browser = await launchBrowser();
  try {
    if (process.argv.includes('--demo-only')) {
      await demoFlow(browser, srv.base);
    } else if (process.argv.includes('--phone-only')) {
      // Phone, impact and QR pages only (fast loop for UI work).
      await phoneCaptures(browser, srv.base, null);
      await webCaptures(browser, srv.base);
    } else {
      await glassCaptures(browser, srv.base);
      await conflictBanner(browser, srv.base);
      await phoneCaptures(browser, srv.base, null);
      await mirrorCapture(browser, srv.base);
      await webCaptures(browser, srv.base);
      await heroImage(browser);
      await demoFlow(browser, srv.base);
    }
  } finally {
    await browser.close().catch(() => {});
    await srv.stop();
  }
  console.log('\nFiles (docs/img):');
  for (const r of report) console.log(`  ${r.name.padEnd(32)} ${String(r.dims).padEnd(11)} ${(r.bytes / 1024).toFixed(0).padStart(5)} KB  dsf ${r.dsf}${r.warn ? '  ' + r.warn : ''}`);
}

main().catch((e) => { console.error('screenshots failed:', e); process.exitCode = 1; });
