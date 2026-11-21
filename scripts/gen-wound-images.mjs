// Generates the two stylised dressing illustrations used by the demo:
//   public/data/wound-previous.jpg  (earlier dressing, slightly lifted edge)
//   public/data/wound-fallback.jpg  (current dressing, sealed)
// Non-graphic on purpose: no blood, no open wound. SVG is rendered to PNG with
// macOS QuickLook (qlmanage) and converted to JPEG with sips. Both ship on macOS.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data');
const SIZE = 640;

function dressing({ lifted }) {
  const edge = lifted
    ? '<path d="M250 300 Q 300 280 350 296" stroke="#c9d3dc" stroke-width="6" fill="none" stroke-linecap="round"/>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#eef2f5"/>
  <path d="M170 60 Q 200 300 190 580 L 430 580 Q 420 300 470 60 Z" fill="#f4e4d6"/>
  <path d="M190 580 L 430 580" stroke="#d9c2b0" stroke-width="4"/>
  <rect x="220" y="250" width="200" height="110" rx="18" fill="#ffffff" stroke="#9fb3c4" stroke-width="5"/>
  <line x1="240" y1="305" x2="400" y2="305" stroke="#c4d2de" stroke-width="4" stroke-dasharray="14 10"/>
  <path d="M220 262 L 220 250 L 232 250" fill="none" stroke="#9fb3c4" stroke-width="4"/>
  ${edge}
  <text x="320" y="450" font-family="Helvetica" font-size="26" text-anchor="middle" fill="#6b7f90">Dressing, left lower leg</text>
</svg>`;
}

function render(svg, name, tmp) {
  const svgPath = join(tmp, `${name}.svg`);
  writeFileSync(svgPath, svg);
  execFileSync('qlmanage', ['-t', '-s', String(SIZE), '-o', tmp, svgPath], { stdio: 'ignore' });
  const png = join(tmp, `${name}.svg.png`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', png, '--out', join(outDir, `${name}.jpg`)], {
    stdio: 'ignore',
  });
  const size = statSync(join(outDir, `${name}.jpg`)).size;
  const magic = readFileSync(join(outDir, `${name}.jpg`)).subarray(0, 3);
  if (magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff) throw new Error(`${name}: not a JPEG`);
  if (size <= 5000) throw new Error(`${name}: JPEG too small (${size} bytes)`);
  console.log(`wrote public/data/${name}.jpg (${size} bytes)`);
}

const tmp = mkdtempSync(join(tmpdir(), 'bg-wound-'));
try {
  render(dressing({ lifted: true }), 'wound-previous', tmp);
  render(dressing({ lifted: false }), 'wound-fallback', tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
