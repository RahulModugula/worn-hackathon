#!/usr/bin/env node
// Stream key-discovery logs from the M6 glasses.
// Pure Node ESM, no shell. Works on Windows, macOS and Linux. Press Ctrl+C to stop.
//
//   node scripts/m6-logcat.mjs                  logcat for the wrapper's BG_KEYS tag (default)
//   node scripts/m6-logcat.mjs --getevent       raw input events from the kernel (getevent -lt)
//   node scripts/m6-logcat.mjs --clear          clear the log buffer first
//   node scripts/m6-logcat.mjs --serial <id>    pick a device when several are attached
//   node scripts/m6-logcat.mjs --help

import { execFileSync, spawn } from 'node:child_process';

const GLASSES_MODEL = 'XNM_Glass';

const HELP = `m6-logcat.mjs: watch key presses on the MicroLumin M6 glasses.

Usage:
  node scripts/m6-logcat.mjs [options]

Options:
  --getevent       Show raw input events (use this if BG_KEYS shows nothing for a button)
  --clear          Clear the log buffer before streaming
  --serial <id>    Use this adb device serial
  --help           Show this help

Default filter: BG_KEYS:D (wrapper key log), BG_PAGE:D (page log), chromium:I (WebView).
Press Ctrl+C to stop.
`;

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

function adbBin() {
  return process.env.ADB || 'adb';
}

function adb(args) {
  try {
    return execFileSync(adbBin(), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new Error(`adb ${args.join(' ')} failed: ${detail}`);
  }
}

function parseArgs(argv) {
  const opts = { getevent: false, clear: false, serial: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--getevent') opts.getevent = true;
    else if (a === '--clear') opts.clear = true;
    else if (a === '--serial') opts.serial = argv[++i] ?? fail('--serial needs a value');
    else fail(`unknown option "${a}". Run with --help.`);
  }
  return opts;
}

function pickSerial(wanted) {
  let lines;
  try {
    lines = adb(['devices', '-l']).split(/\r?\n/).slice(1);
  } catch {
    fail('adb not found. Install platform-tools, add them to PATH, or set ADB to the full path of adb.');
  }
  const devices = lines
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2)
    .map((p) => ({ serial: p[0], state: p[1], model: (p.join(' ').match(/model:(\S+)/) || [])[1] || '' }));
  if (wanted) {
    if (!devices.some((d) => d.serial === wanted)) fail(`no device with serial "${wanted}".`);
    return wanted;
  }
  const ready = devices.filter((d) => d.state === 'device');
  if (ready.length === 0) fail('no adb device found. Connect the glasses with Developer Mode on.');
  const glasses = ready.find((d) => d.model === GLASSES_MODEL);
  if (glasses) return glasses.serial;
  if (ready.length === 1) return ready[0].serial;
  fail(`${ready.length} devices attached and none is ${GLASSES_MODEL}. Re-run with --serial <id>:\n` +
    ready.map((d) => `  ${d.serial}  model=${d.model || 'unknown'}`).join('\n'));
}

function stream(args) {
  console.log(`Streaming: adb ${args.join(' ')}\nPress Ctrl+C to stop.\n`);
  const child = spawn(adbBin(), args, { stdio: 'inherit' });
  child.on('error', (err) => fail(`could not start adb: ${err.message}`));
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const serial = pickSerial(opts.serial);
  if (opts.clear) {
    adb(['-s', serial, 'logcat', '-c']);
    console.log('Log buffer cleared.');
  }
  if (opts.getevent) {
    stream(['-s', serial, 'shell', 'getevent', '-lt']);
  } else {
    stream(['-s', serial, 'logcat', '-s', 'BG_KEYS:D', 'BG_PAGE:D', 'chromium:I']);
  }
}

main();
