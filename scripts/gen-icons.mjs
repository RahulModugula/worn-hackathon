#!/usr/bin/env node
// Generates the app icons from the Bedside Glance brand mark (a rounded square, four corner ticks, one dot):
//   public/icons/icon-192.png, icon-512.png, apple-touch-icon.png (180 px)
// Renders an inline SVG with the system Chrome through puppeteer-core (cross-platform: CHROME_PATH or the usual
// install paths, same lookup as scripts/screenshots.mjs). Colours match phone/tokens.css (--bg, --accent, --accent-ink),
// converted from OKLCH to sRGB hex: bg oklch(0.155 0.012 250), accent oklch(0.84 0.15 158), ink oklch(0.2 0.045 158).
// Run: node scripts/gen-icons.mjs
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from './e2e/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');

const BG = '#080d11';
const ACCENT = '#67e8a5';
const INK = '#011c0e';

/** Same geometry as BrandMark in src/apps/bedside-glance/phone/ui.tsx (32 unit grid). Mark covers 62% of the icon: inside the maskable safe zone. */
function svg(size) {
  const mark = size * 0.62;
  const off = (size - mark) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${off} ${off}) scale(${mark / 32})">
    <rect width="32" height="32" rx="9" fill="${ACCENT}"/>
    <path d="M9.5 14v-2.5a2 2 0 0 1 2-2H14M18 9.5h2.5a2 2 0 0 1 2 2V14M22.5 18v2.5a2 2 0 0 1-2 2H18M14 22.5h-2.5a2 2 0 0 1-2-2V18"
      fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="2.6" fill="${INK}"/>
  </g>
</svg>`;
}

const TARGETS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  for (const [name, size] of TARGETS) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:${BG}">${svg(size)}</body></html>`);
    const file = join(OUT, name);
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`${name}  ${size}x${size}  ${statSync(file).size} bytes`);
  }
} finally {
  await browser.close();
}
