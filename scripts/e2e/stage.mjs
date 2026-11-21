// Live /stage flow shared by the e2e scenario and the screenshot script: real glasses page, a Director phone, a second
// (Marcus) phone and the projector page on one session. Calls onState(name, stagePage) at 'linked', 'chaos', 'recovered'.
import {
  CANVAS, GLASSES_VP, IPHONE_UA, PHONE_VP, clickButton, closeDrawer, directorTap, ensureDrawerOpen, openPage, sleep, waitForScreen, waitForText,
} from './lib.mjs';

export const STAGE_VP = { width: 1280, height: 720, deviceScaleFactor: 1 };
const text = (sel) => (page) => page.$eval(sel, (el) => el.textContent ?? '').catch(() => '');
const linkText = text('[data-testid="link-text"]');

export async function runStageFlow(browser, base, sid, onState = async () => {}) {
  const out = {};
  const dir = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
  const gl = await openPage(browser, { viewport: GLASSES_VP });
  const mar = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
  const stg = await openPage(browser, { viewport: STAGE_VP });
  const P = dir.page, G = gl.page, M = mar.page, S = stg.page;
  try {
    await P.goto(`${base}/phone?director=1&session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForText(P, 'Connected to demo session', { timeout: 15000 });
    await G.goto(`${base}/glasses?session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForScreen(G, 'G1', 15000);
    await M.goto(`${base}/phone?nurse=N-02&session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForText(M, 'Connected to demo session', { timeout: 15000 });
    await S.goto(`${base}/stage?session=${sid}`, { waitUntil: 'domcontentloaded' });

    await directorTap(P, 'Start Shift');
    await waitForText(P, 'Shift started');
    await directorTap(P, 'Sim Scan Rm 12');
    await waitForText(G, 'Maria', { scope: CANVAS, timeout: 5000 });

    // Linked: glasses present, devices listed in sync.
    await S.waitForFunction(() => {
      const t = document.querySelector('[data-testid="link-text"]')?.textContent ?? '';
      const rows = document.querySelector('[aria-label="Devices"]')?.textContent ?? '';
      return t.startsWith('Linked') && rows.includes('Glasses') && rows.includes('Phone') && rows.includes('in sync');
    }, { timeout: 15000, polling: 100 });
    out.devices = await S.$eval('[aria-label="Devices"]', (el) => el.textContent ?? '');
    await sleep(300);
    await onState('linked', S);

    // Chaos: link down + done (8 s). The rail must say Not linked, then recover with a replay.
    await ensureDrawerOpen(P);
    await clickButton(P, '.ph-director', '2 Chaos', { contains: true });
    await S.waitForFunction(() => (document.querySelector('[data-testid="link-text"]')?.textContent ?? '').startsWith('Not linked'), { timeout: 8000, polling: 100 });
    await sleep(1800); // let the down timer tick
    out.chaosLink = await linkText(S);
    out.chaosChip = await S.$eval('[data-testid="link-chip"]', (el) => el.textContent ?? '');
    out.stageHudStrip = await S.$eval('[data-hud="status-strip"]', (el) => el.textContent ?? '').catch(() => '');
    await onState('chaos', S);

    await S.waitForFunction(() => {
      const t = document.querySelector('[data-testid="link-text"]')?.textContent ?? '';
      const r = document.querySelector('[data-testid="replay-text"]')?.textContent ?? '';
      return t.startsWith('Linked') && /\d+ replayed/.test(r);
    }, { timeout: 25000, polling: 150 });
    await S.waitForFunction(() => /0 lost/.test(document.querySelector('[data-testid="replay-text"]')?.textContent ?? ''), { timeout: 15000, polling: 150 })
      .catch(async (e) => { throw new Error(`no "0 lost": replay="${await text('[data-testid="replay-text"]')(S)}" devices="${await S.$eval('[aria-label="Devices"]', (el) => el.textContent ?? '')}" (${e.message.split('\n')[0]})`); });
    out.replay = await text('[data-testid="replay-text"]')(S);
    await sleep(300);
    await onState('recovered', S);

    // Handoff: the newest chain on the projector names it.
    await closeDrawer(P);
    await directorTap(P, '3 Hand off Rm 12');
    await S.waitForFunction(() => (document.querySelector('.st-chain-title')?.textContent ?? '').includes('Handoff offered'), { timeout: 8000, polling: 100 });
    out.chain = await S.$eval('.st-chain', (el) => el.textContent ?? '');
    return out;
  } finally {
    await Promise.all([P, G, M, S].map((p) => p.close().catch(() => {})));
    out.problems = [...dir.problems, ...gl.problems, ...mar.problems, ...stg.problems];
  }
}
