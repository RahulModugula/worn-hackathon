#!/usr/bin/env node
// Size budget for the JS and CSS the /glasses route needs, plus a check that the
// /glasses graph does not contain phone, impact or qr code. Run after `npm run build`.
// Pure Node. Exit 1 on any violation. Measurements and method: docs/COMPAT-PERF.md.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// Budgets: measured gzip size on 2026-11-21 (see docs/COMPAT-PERF.md) plus ~15% headroom.
// Measured: JS 121192 B gzip, CSS 1309 B gzip (2026-11-21, one build, gzip level 9).
const BUDGET_GZIP_JS_BYTES = 140000; // 121192 x 1.15 ~ 139370, rounded up
const BUDGET_GZIP_CSS_BYTES = 2010; // HUD redesign 2026-11-21 (icons, asides, progress, 5 type roles): measured 1746 B gzip x 1.15 ~ 2008, rounded up. The Nunito woff2 (39 KB) is a font file, not counted here.

// Strings that exist only in the lazy /phone, /impact, /qr and /stage chunks. Each must be
// present in some non-entry chunk (so the sentinel is valid) and absent from /glasses.
const FORBIDDEN_IN_GLASSES = {
  phone: ['Compared with previous', 'Wound photo ready for review'],
  impact: ['Where the numbers come from', 'Loaded cost per nurse per year'],
  qr: ['qr-sheet'],
  stage: ['On-glasses latency not measured'],
};

const failures = [];
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

const manifestPath = join(DIST, '.vite', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('check-budgets: dist/.vite/manifest.json missing. Run `npm run build` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) {
  console.error('check-budgets: no entry chunk in manifest.');
  process.exit(1);
}

// /glasses graph = entry chunk + its static imports (transitively) + their CSS. Dynamic imports are excluded.
const glassesJs = new Set();
const glassesCss = new Set();
const visit = (key) => {
  if (glassesJs.has(manifest[key].file)) return;
  glassesJs.add(manifest[key].file);
  for (const css of manifest[key].css ?? []) glassesCss.add(css);
  for (const dep of manifest[key].imports ?? []) visit(dep);
};
visit(entryKey);

const read = (file) => readFileSync(join(DIST, file));
const jsText = (file) => read(file).toString('utf8');
const glassesJsBytes = [...glassesJs].reduce((n, f) => n + gz(read(f)), 0);
const glassesCssBytes = [...glassesCss].reduce((n, f) => n + gz(read(f)), 0);

// Sentinels: each must appear in a lazy chunk, and nowhere in the /glasses graph.
const allJsFiles = Object.values(manifest).map((m) => m.file).filter((f) => f.endsWith('.js'));
const glassesText = [...glassesJs].map(jsText).join('\n');
for (const [page, strings] of Object.entries(FORBIDDEN_IN_GLASSES)) {
  for (const s of strings) {
    if (glassesText.includes(s)) failures.push(`/glasses graph contains ${page} string "${s}"`);
    const lazy = allJsFiles.filter((f) => !glassesJs.has(f)).some((f) => jsText(f).includes(s));
    if (!lazy) failures.push(`sentinel "${s}" (${page}) not found in any lazy chunk: update FORBIDDEN_IN_GLASSES`);
  }
}

if (glassesJsBytes > BUDGET_GZIP_JS_BYTES) {
  failures.push(`/glasses JS gzip ${glassesJsBytes} B exceeds budget ${BUDGET_GZIP_JS_BYTES} B`);
}
if (glassesCssBytes > BUDGET_GZIP_CSS_BYTES) {
  failures.push(`/glasses CSS gzip ${glassesCssBytes} B exceeds budget ${BUDGET_GZIP_CSS_BYTES} B`);
}

console.log(`/glasses graph: ${glassesJs.size} JS chunk(s), ${glassesCss.size} CSS file(s)`);
console.log(`  JS  gzip ${glassesJsBytes} B (budget ${BUDGET_GZIP_JS_BYTES} B)`);
console.log(`  CSS gzip ${glassesCssBytes} B (budget ${BUDGET_GZIP_CSS_BYTES} B)`);
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`check-budgets: ${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
