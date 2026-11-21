// Shared helpers for the real-browser E2E check (scripts/e2e/run.mjs) and the screenshot pipeline (scripts/screenshots.mjs).
// Pure Node ESM. Drives the production build through the real WebSocket with the system Chrome via puppeteer-core.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
/** Android 9 WebView era UA (Chrome 69). Used only to confirm /glasses has no UA-sniff console errors. */
export const OLD_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 9; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Mobile Safari/537.36';

export const GLASSES_VP = { width: 640, height: 480, deviceScaleFactor: 2 };
export const PHONE_VP = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** Known optional third-party/service requests that may fail without API keys. Keep this list short and explicit. */
export const KNOWN_OPTIONAL_FAILURES = [
  /generativelanguage\.googleapis\.com/, // Gemini wound assessment, optional (server falls back to bundled sample)
  /api\.deepgram\.com/, // Deepgram STT, optional
];

const CHROME_CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: [
    path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  linux: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
};

/** CHROME_PATH wins; otherwise the first installed Chrome/Chromium for this platform. Throws with a clear message if none. */
export function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) {
    if (existsSync(env)) return env;
    throw new Error(`CHROME_PATH is set but does not exist: ${env}`);
  }
  const candidates = CHROME_CANDIDATES[process.platform] ?? [];
  const hit = candidates.find((p) => p && existsSync(p));
  if (hit) return hit;
  throw new Error(
    `No Chrome found. Install Google Chrome or set CHROME_PATH to a Chrome/Chromium binary. Searched: ${candidates.join(' | ') || '(none for this platform)'}`,
  );
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function ensureDist() {
  if (existsSync(path.join(ROOT, 'dist', 'index.html'))) return;
  console.log('dist/ missing: running npm run build');
  const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('npm run build failed');
}

/**
 * Starts the production server (Express serves dist/ and the API on one port) on a free port.
 * Stop it with the returned stop(): it signals this child process only, never by name.
 */
export async function startServer() {
  ensureDist();
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  delete env.DIRECTOR_KEY; // the harness drives the Director with ?director=1
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const deadline = Date.now() + 30_000;
  while (!log.join('').includes('server on')) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log.join('')}`);
    if (Date.now() > deadline) { child.kill('SIGTERM'); throw new Error(`server did not start:\n${log.join('')}`); }
    await sleep(100);
  }
  return {
    base: `http://127.0.0.1:${port}`,
    log,
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM');
      const t = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(t);
    },
  };
}

export async function launchBrowser() {
  const executablePath = findChrome();
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

/** Opens a page and records console errors, page errors, failed requests and HTTP >= 400 responses. */
export async function openPage(browser, { ua, viewport }) {
  const page = await browser.newPage();
  const problems = [];
  if (ua) await page.setUserAgent(ua);
  await page.setViewport(viewport);
  page.on('console', (m) => { if (m.type() === 'error') problems.push({ kind: 'console', text: m.text() }); });
  page.on('pageerror', (e) => problems.push({ kind: 'pageerror', text: String(e.message ?? e) }));
  page.on('requestfailed', (r) => problems.push({ kind: 'request-failed', text: `${r.url()} ${r.failure()?.errorText ?? ''}` }));
  page.on('response', (r) => { if (r.status() >= 400) problems.push({ kind: 'http', text: `${r.status()} ${r.url()}` }); });
  return { page, problems };
}

/** Problems that are not on the known-optional list. */
export function unexpectedProblems(problems) {
  return problems.filter((p) => !KNOWN_OPTIONAL_FAILURES.some((re) => re.test(p.text)));
}

/** Click the visible button whose trimmed text equals `label` inside `scope` (a CSS selector). Real mouse click. */
export async function clickButton(page, scope, label, { contains = false } = {}) {
  // Two pages in one browser: only the focused page gets real input, so bring this one forward first.
  await page.bringToFront();
  const handle = await page.evaluateHandle((scope, label, contains) => {
    const root = document.querySelector(scope);
    if (!root) return null;
    const buttons = [...root.querySelectorAll('button')];
    return buttons.find((b) => {
      const t = (b.textContent ?? '').trim();
      return contains ? t.includes(label) : t === label;
    }) ?? null;
  }, scope, label, contains);
  const el = handle.asElement();
  if (!el) throw new Error(`no button "${label}" in ${scope}`);
  await el.click();
  await handle.dispose();
}

/** Tap a medication row on the phone (.ph-med). Matches rows only: the Undo button's label also contains the med name. */
export async function clickMedRow(page, medName) {
  await page.bringToFront();
  const handle = await page.evaluateHandle((name) => {
    return [...document.querySelectorAll('button.ph-med')].find((b) => b.textContent.includes(name)) ?? null;
  }, medName);
  const el = handle.asElement();
  if (!el) throw new Error(`no .ph-med row for "${medName}"`);
  await el.click();
  await handle.dispose();
}

export async function directorTap(page, label) {
  await ensureDrawerOpen(page);
  await clickButton(page, '.ph-director', label);
}

export async function ensureDrawerOpen(page) {
  const open = await page.$('.ph-director');
  if (open) return;
  await page.bringToFront();
  const fab = await page.$('[aria-label="Open Director Drawer"]');
  if (fab) await fab.click();
  await page.waitForSelector('.ph-director', { timeout: 5000 });
}

export async function closeDrawer(page) {
  if (await page.$('.ph-director')) await clickButton(page, '.ph-director', 'Close');
  await sleep(150);
}

/** Waits until `scope` (default body) text contains `text`. Returns elapsed ms. */
export async function waitForText(page, text, { scope = 'body', timeout = 8000 } = {}) {
  const t0 = Date.now();
  await page.waitForFunction(
    (scope, text) => {
      const el = document.querySelector(scope);
      return !!el && (el.textContent ?? '').includes(text);
    },
    { timeout, polling: 50 },
    scope, text,
  );
  return Date.now() - t0;
}

export async function textOf(page, scope) {
  return page.$eval(scope, (el) => el.textContent ?? '').catch(() => '');
}

export const CANVAS = '[data-hud="canvas"]';

/** Screen id the glasses are showing (G1..G9, VITALS, ALLERGY), from the canvas data-screen attribute. */
export async function currentScreen(page) {
  return page.$eval(CANVAS, (c) => c.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null).catch(() => null);
}

export async function waitForScreen(page, id, timeout = 8000) {
  await page.waitForFunction(
    (id) => !!document.querySelector('[data-hud="canvas"] [data-screen="' + id + '"]'),
    { timeout, polling: 50 }, id,
  );
}

/** Hides desktop-preview chrome so the canvas is the only thing in the frame. Returns an undo function. */
export async function hidePreviewChrome(page) {
  const h = await page.addStyleTag({
    content: '[data-desktop-controls],[data-telemetry-bar],.hud-preview__controls{display:none!important}' +
      'body,html{background:#000!important;margin:0!important}.hud-preview{padding:0!important;margin:0!important}',
  });
  return async () => { await page.evaluate((el) => el.remove(), h); };
}

/** Element screenshot as PNG at the page's current deviceScaleFactor, or a viewport screenshot. */
export async function shotTo(target, file) {
  await target.screenshot({ path: file, type: 'png' });
  return statSync(file).size;
}

export async function setDsf(page, deviceScaleFactor) {
  const vp = page.viewport();
  await page.setViewport({ ...vp, deviceScaleFactor });
  await sleep(150);
}

/** PNG width/height from the IHDR chunk (no image library needed). */
export function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
