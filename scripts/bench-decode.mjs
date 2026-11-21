#!/usr/bin/env node
// Benchmarks the pure-JS QR decoder (qr/decode.js) on the glasses scanner's input size:
// a 480x480 RGBA frame (the center crop used by src/hud-kit/scan/qrScanner.ts).
// Two inputs: a Version 1 code, and a blank white frame (the common miss path).
// Usage: npm run bench   (200 timed runs after 20 warm-up runs, Node on this machine)
import { performance } from 'node:perf_hooks';
import { encodeQR } from 'qr';
import decodeQR from 'qr/decode.js';

const SIZE = 480;
const RUNS = 200;
const WARMUP = 20;
const PERIOD_MS = 250; // 4 FPS
const PAYLOAD = 'WORN-1';

// Version 1 = 21x21 modules. encodeQR returns a 25x25 grid (2-module border); take the 21x21 core.
// Scale 16 px per module, centred: 336 px core, 72 px white margin each side (>= 4 modules).
function codeFrame(payload) {
  const grid = encodeQR(payload, 'raw', { version: 1, ecc: 'medium', border: 1 }).slice(1, -1).map((r) => r.slice(1, -1));
  const modules = grid.length;
  const scale = 16;
  const core = modules * scale;
  const offset = (SIZE - core) / 2;
  const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const mx = Math.floor((x - offset) / scale);
      const my = Math.floor((y - offset) / scale);
      const inside = x >= offset && y >= offset && mx < modules && my < modules;
      const dark = inside && grid[my][mx];
      const i = (y * SIZE + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

function blankFrame() {
  return { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(255) };
}

// Sanity: the code frame must decode to the payload, or the timing means nothing.
const coded = codeFrame(PAYLOAD);
const decoded = decodeQR(coded, { format: 'RGBA' });
if (decoded !== PAYLOAD) {
  console.error(`bench-decode: sanity decode returned ${JSON.stringify(decoded)}, expected ${JSON.stringify(PAYLOAD)}`);
  process.exit(1);
}

// The scanner treats a throw from decodeQR as a miss (qrScanner.ts). Mirror that here and count misses.
function runOnce(frame) {
  const t0 = performance.now();
  let result = null;
  try {
    result = decodeQR(frame, { format: 'RGBA' }) || null;
  } catch {
    result = null;
  }
  return { ms: performance.now() - t0, hit: result !== null };
}

function bench(label, frame) {
  for (let i = 0; i < WARMUP; i++) runOnce(frame);
  const times = [];
  let hits = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = runOnce(frame);
    times.push(r.ms);
    if (r.hit) hits++;
  }
  times.sort((a, b) => a - b);
  const pick = (p) => times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)];
  return { label, median: pick(50), p95: pick(95), max: times[times.length - 1], hits };
}

const results = [bench('Version 1 code', coded), bench('blank frame', blankFrame())];
console.log(`qr/decode.js, ${SIZE}x${SIZE} RGBA, ${RUNS} runs after ${WARMUP} warm-up, node ${process.version}, ${process.platform}/${process.arch}, ${new Date().toISOString().slice(0, 10)}`);
for (const r of results) {
  console.log(
    `${r.label.padEnd(16)} median ${r.median.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms  max ${r.max.toFixed(2)} ms  decoded ${r.hits}/${RUNS}`,
  );
}
const worst = results.reduce((a, b) => (a.p95 > b.p95 ? a : b));
const multiple = PERIOD_MS / worst.p95;
console.log(`4 FPS budget: ${PERIOD_MS} ms per frame. Headroom on this machine, worst p95 (${worst.label}): ${multiple.toFixed(0)}x`);
// Old phones are not measured here. A slowdown factor of S keeps the p95 inside the budget while S < multiple.
// Plan with a 10x safety factor (a deliberately wide margin for a 2016-era WebView/CPU; unmeasured).
const SAFETY = 10;
console.log(
  `Safe multiple (budget 250 ms / 10x safety margin): the device may be up to ${(multiple / SAFETY).toFixed(0)}x slower than this machine. ` +
    `Old-phone speed is NOT measured here; confirm on the Android 9 device before relying on it.`,
);
