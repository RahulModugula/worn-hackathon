// Real-browser E2E: production server + system Chrome. Two pages in one session: the phone Director (/phone?director=1)
// and the glasses (/glasses). Run with `npm run e2e`. Exit code 1 if any check fails.
import {
  CANVAS, GLASSES_VP, IPHONE_UA, OLD_CHROME_UA, PHONE_VP, clickButton, clickMedRow, closeDrawer, directorTap, launchBrowser,
  openPage, sleep, startServer, unexpectedProblems, waitForScreen, waitForText, currentScreen,
} from './lib.mjs';

const results = [];
async function check(name, fn) {
  console.log(`... ${name}`);
  try {
    const detail = (await fn()) ?? '';
    results.push({ name, ok: true, detail: String(detail) });
    console.log(`    ok ${String(detail)}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message ?? e).split('\n')[0] });
    console.log(`    FAIL ${String(e.message ?? e).split('\n')[0]}`);
  }
}

/** Text-overflow audit on the 640x480 canvas: no clipped text, and no text box inside the clear zone x120-520, y90-290. */
async function auditCanvas(page) {
  return page.evaluate((CANVAS) => {
    const canvas = document.querySelector(CANVAS);
    if (!canvas) return { screen: null, violations: ['no canvas'] };
    const cr = canvas.getBoundingClientRect();
    const scale = cr.width / 640;
    const violations = [];
    const screen = canvas.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null;
    const hasDirectText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    for (const el of canvas.querySelectorAll('*')) {
      if (hasDirectText(el) && el.scrollWidth > el.clientWidth + 1) {
        violations.push(`overflow: "${el.textContent.trim().slice(0, 40)}" scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      }
    }
    const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!text) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const x = (r.left - cr.left) / scale, y = (r.top - cr.top) / scale;
      const w = r.width / scale, h = r.height / scale;
      if (x < -0.5 || y < -0.5 || x + w > 640.5 || y + h > 480.5) {
        violations.push(`clipped by canvas edge: "${text.slice(0, 40)}" at (${x.toFixed(0)},${y.toFixed(0)})`);
      }
      const hitsZone = x < 520 && x + w > 120 && y < 290 && y + h > 90;
      if (hitsZone) violations.push(`text in clear zone: "${text.slice(0, 40)}" at (${x.toFixed(0)},${y.toFixed(0)})`);
    }
    return { screen, violations };
  }, CANVAS);
}

async function main() {
  const srv = await startServer();
  const browser = await launchBrowser();
  const sid = `e2e-${Date.now().toString(36)}`;
  const allProblems = { phone: null, glasses: null, oldUa: null };
  try {
    const phone = await openPage(browser, { ua: IPHONE_UA, viewport: PHONE_VP });
    const glasses = await openPage(browser, { viewport: GLASSES_VP });
    allProblems.phone = phone.problems;
    allProblems.glasses = glasses.problems;
    const P = phone.page, G = glasses.page;

    await P.goto(`${srv.base}/phone?director=1&session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForText(P, 'Connected to demo session', { timeout: 15000 });
    await G.goto(`${srv.base}/glasses?session=${sid}`, { waitUntil: 'domcontentloaded' });
    await waitForScreen(G, 'G1', 15000);

    await check('1. Start Shift -> Sim Scan Rm 12 -> glasses show Maria + Metformin; phone P2 opens', async () => {
      await directorTap(P, 'Start Shift');
      await waitForText(P, 'Shift started');
      await directorTap(P, 'Sim Scan Rm 12');
      const tGlasses = await waitForText(G, 'Maria', { scope: CANVAS, timeout: 5000 });
      await waitForText(G, 'Metformin', { scope: CANVAS, timeout: 5000 });
      await P.waitForFunction(() => !!document.querySelector('.ph-med') && document.body.textContent.includes('Maria'), { timeout: 5000 });
      return `glasses showed Maria in ${tGlasses} ms; phone P2 open (.ph-med rows present)`;
    });

    await check('2. Voice: Done -> phone shows check "via glasses" within 1 s', async () => {
      const t0 = Date.now();
      await directorTap(P, 'Voice: Done');
      await P.waitForFunction(() => [...document.querySelectorAll('.ph-med-given')].some((el) => el.textContent.includes('✓') && el.textContent.includes('glasses')), { timeout: 5000, polling: 25 });
      const ms = Date.now() - t0;
      if (ms > 1000) throw new Error(`took ${ms} ms (limit 1000)`);
      return `${ms} ms from Director click to phone check`;
    });

    await check('3. Phone logs the same med -> "Already given" conflict text', async () => {
      await closeDrawer(P);
      await clickMedRow(P, 'Metformin');
      await waitForText(P, 'Already given', { timeout: 3000 });
      return 'conflict text shown on phone';
    });

    await check('4. Undo within 10 s works from the phone', async () => {
      const undoEnabled = await P.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('Undo') && !x.disabled);
        return !!b;
      }, { timeout: 1500, polling: 50 }).then(() => true, () => false);
      if (!undoEnabled) throw new Error('Undo button not enabled (window closed?)');
      await clickButton(P, '[data-testid="phone-app"]', 'Undo', { contains: true });
      await P.waitForFunction(() => ![...document.querySelectorAll('.ph-med-given')].some((el) => el.textContent.includes('glasses')), { timeout: 2000, polling: 50 });
      return 'voice log removed; med shows as due again';
    });

    await check('5. Force Offline (glasses) -> glasses show Not linked', async () => {
      await clickButton(G, '[data-desktop-controls]', 'Force Offline');
      const ms = await waitForText(G, 'Not linked', { scope: CANVAS, timeout: 3000 });
      await clickButton(G, '[data-desktop-controls]', 'Force Offline');
      await G.waitForFunction((c) => !(document.querySelector(c)?.textContent ?? '').includes('Not linked'), { timeout: 3000 }, CANVAS);
      return `shown after ${ms} ms; restored online`;
    });

    await check('6. RESET DEMO (two-step) clears everything within 500 ms', async () => {
      await directorTap(P, 'RESET DEMO');
      const t0 = Date.now();
      await clickButton(P, '.ph-director', 'Yes, RESET DEMO');
      await P.waitForFunction(() => {
        const hero = document.querySelector('.ph-btn-hero');
        return !!hero && hero.textContent.includes('Start Shift');
      }, { timeout: 2000, polling: 16 });
      const ms = Date.now() - t0;
      await G.waitForFunction((c) => !(document.querySelector(c)?.textContent ?? '').includes('Maria'), { timeout: 2000, polling: 16 }, CANVAS);
      const msAll = Date.now() - t0;
      if (msAll > 500) throw new Error(`phone ${ms} ms, glasses ${msAll} ms (limit 500)`);
      return `phone reset in ${ms} ms, glasses cleared in ${msAll} ms`;
    });

    await check('6b. Allergy: conflicting order -> acknowledge -> "done" never logs the allergen (confirm on phone)', async () => {
      await directorTap(P, 'Start Shift');
      await directorTap(P, 'Sim Scan Rm 12');
      await waitForText(G, 'Metformin', { scope: CANVAS, timeout: 5000 });
      await directorTap(P, 'Add Conflicting Order');
      await waitForScreen(G, 'ALLERGY', 5000);
      await waitForText(G, 'Amoxicillin', { scope: CANVAS, timeout: 3000 });
      // Headless Chrome has no microphone, so the preview hotkey stands in for saying "acknowledge".
      await G.keyboard.press('k');
      await waitForScreen(G, 'G4', 5000);
      await waitForText(G, 'Metformin', { scope: CANVAS, timeout: 3000 }); // the real med is the hero, not the allergen
      await directorTap(P, 'Voice: Done'); // logs Metformin
      await P.waitForFunction(() => [...document.querySelectorAll('.ph-med-given')].some((el) => el.textContent.includes('glasses')), { timeout: 5000, polling: 25 });
      await waitForScreen(G, 'G5', 3000);
      await waitForScreen(G, 'G4', 6000); // G5 fades after 3 s; the acknowledged allergen is the only med left
      await directorTap(P, 'Voice: Done'); // would log Amoxicillin before the fix
      await waitForText(G, 'Allergy \u00b7 confirm on phone', { scope: CANVAS, timeout: 3000 });
      const logged = await P.evaluate(() => [...document.querySelectorAll('.ph-med-given')].map((el) => el.textContent).join(' | '));
      if (/Amoxicillin/.test(logged)) throw new Error('allergen was logged: ' + logged);
      return 'Metformin first, then the toast "Allergy · confirm on phone"; Amoxicillin never logged';
    });

    await check('7. Text-overflow + clear-zone audit on glasses screens', async () => {
      const seen = [];
      const violations = [];
      const audit = async (label) => {
        const a = await auditCanvas(G);
        seen.push(`${label}=${a.screen}`);
        for (const v of a.violations) violations.push(`[${label}/${a.screen}] ${v}`);
      };
      for (const k of ['1', '2', '3']) { await G.keyboard.press(k); await sleep(200); await audit(`key${k}`); }
      await directorTap(P, 'Sim Scan Rm 12');
      await waitForText(G, 'Maria', { scope: CANVAS });
      await sleep(200); await audit('G4');
      await directorTap(P, 'Voice: Done'); await sleep(250); await audit('G5');
      await directorTap(P, 'Trigger: Pain'); await sleep(250); await audit('G6');
      await directorTap(P, 'Trigger: Wound'); await sleep(250); await audit('G7');
      // Nurse-documented dressing: the same G7 line with the documented times, audited like every other screen.
      await directorTap(P, 'Capture Wound Photo');
      await waitForText(G, 'Wound \u00b7', { scope: CANVAS });
      await directorTap(P, 'Demo: Set Dressing'); await sleep(300);
      await directorTap(P, 'Trigger: Wound');
      await waitForText(G, 'Changed 1:', { scope: CANVAS });
      await sleep(250); await audit('G7dress');
      await directorTap(P, 'Trigger Allergy Alert'); await sleep(250); await audit('ALLERGY');
      if (violations.length) throw new Error(violations.slice(0, 4).join(' | ') + (violations.length > 4 ? ` (+${violations.length - 4} more)` : ''));
      return `${seen.length} states clean: ${seen.join(', ')}`;
    });

    await check('7b. Audit control: a planted clear-zone label is flagged', async () => {
      // Negative control: the audit must fail on a known violation, or a PASS in check 7 means nothing.
      await G.evaluate((CANVAS) => {
        const d = document.createElement('div');
        d.setAttribute('data-planted', '1');
        d.style.cssText = 'position:absolute;left:200px;top:150px;color:#fff;font:14px monospace';
        d.textContent = 'PLANTED';
        document.querySelector(CANVAS).appendChild(d);
      }, CANVAS);
      const a = await auditCanvas(G);
      await G.evaluate(() => document.querySelectorAll('[data-planted]').forEach((n) => n.remove()));
      const hit = a.violations.find((v) => v.includes('PLANTED'));
      if (!hit) throw new Error('audit did not flag the planted text');
      return `flagged: ${hit.replace(/^\[[^\]]*\] /, '')}`;
    });

    await check('8. Zero console errors, no failed requests (except known optional)', async () => {
      const p = unexpectedProblems([...allProblems.phone, ...allProblems.glasses]);
      if (p.length) throw new Error(p.slice(0, 3).map((x) => `${x.kind}: ${x.text}`).join(' | '));
      return `phone ${allProblems.phone.length} raw / glasses ${allProblems.glasses.length} raw, 0 unexpected`;
    });

    await check('9. /glasses with old Chrome/69 UA: no console errors', async () => {
      const old = await openPage(browser, { ua: OLD_CHROME_UA, viewport: GLASSES_VP });
      allProblems.oldUa = old.problems;
      await old.page.goto(`${srv.base}/glasses?session=${sid}-ua`, { waitUntil: 'domcontentloaded' });
      await waitForScreen(old.page, 'G1', 15000);
      await sleep(500);
      const ua = await old.page.evaluate(() => navigator.userAgent);
      const p = unexpectedProblems(old.problems);
      await old.page.close();
      if (p.length) throw new Error(p.slice(0, 3).map((x) => `${x.kind}: ${x.text}`).join(' | '));
      return `screen G1 rendered; UA ${ua.includes('Chrome/69') ? 'Chrome/69' : 'set'}; 0 console errors`;
    });
    void currentScreen; // exported helper kept for ad-hoc debugging
  } finally {
    await browser.close().catch(() => {});
    await srv.stop();
  }
  // Late errors from the UA page (none expected) are folded into a final summary line, not a separate check.
  const oldLate = allProblems.oldUa ? unexpectedProblems(allProblems.oldUa).length : 0;

  const width = Math.max(...results.map((r) => r.name.length));
  console.log('\nE2E results (Chrome via puppeteer-core, production build)\n');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed${oldLate ? `, ${oldLate} late unexpected errors on old-UA page` : ''}`);
  if (results.some((r) => !r.ok) || oldLate) process.exitCode = 1;
}

main().catch((e) => {
  console.error('E2E harness error:', e);
  process.exitCode = 1;
});
