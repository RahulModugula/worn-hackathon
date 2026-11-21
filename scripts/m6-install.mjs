#!/usr/bin/env node
// Install the Bedside Glance wrapper on the MicroLumin M6 glasses over adb and launch it.
// Pure Node ESM, no shell. Works on Windows, macOS and Linux.
//
//   node scripts/m6-install.mjs                 install + launch the default page
//   node scripts/m6-install.mjs --mirror        also append ?mirror=1
//   node scripts/m6-install.mjs --url <url>     load a different page URL on the glasses
//   node scripts/m6-install.mjs --serial <id>   pick a device when several are attached
//   node scripts/m6-install.mjs --help

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'com.bedsideglance.wrapper';
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const PORT = Number(process.env.PORT) || 3001;
const DEFAULT_URL = `http://localhost:${PORT}/glasses`;
const GLASSES_MODEL = 'XNM_Glass';
const PERMISSIONS = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'];

const here = dirname(fileURLToPath(import.meta.url));
const APK = resolve(here, '..', 'android-wrapper', 'prebuilt', 'bedside-wrapper-debug.apk');

const HELP = `m6-install.mjs: install the Bedside Glance wrapper on the MicroLumin M6 glasses.

Usage:
  node scripts/m6-install.mjs [options]

Options:
  --url <url>      Page to load on the glasses (default ${DEFAULT_URL})
  --mirror         Append mirror=1 to the page URL
  --serial <id>    Use this adb device serial (needed when several devices are attached)
  --help           Show this help

Before running: start the web app on this computer on port ${PORT}, and plug in the glasses
with Developer Mode on (see scripts/m6-keys.md and android-wrapper/README.md).
Set the ADB environment variable to a full path if adb is not on your PATH.
`;

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

function adbBin() {
  return process.env.ADB || 'adb';
}

// Runs adb with argv (no shell). Returns stdout text; throws with stderr on failure.
function adb(args) {
  try {
    return execFileSync(adbBin(), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new Error(`adb ${args.join(' ')} failed: ${detail}`);
  }
}

function parseArgs(argv) {
  const opts = { url: DEFAULT_URL, mirror: false, serial: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--mirror') opts.mirror = true;
    else if (a === '--url') opts.url = argv[++i] ?? fail('--url needs a value');
    else if (a === '--serial') opts.serial = argv[++i] ?? fail('--serial needs a value');
    else fail(`unknown option "${a}". Run with --help.`);
  }
  return opts;
}

function buildUrl(base, mirror) {
  let u;
  try {
    u = new URL(base);
  } catch {
    fail(`not a valid URL: ${base}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') fail(`URL must be http or https: ${base}`);
  if (mirror) u.searchParams.set('mirror', '1');
  return u.toString();
}

function listDevices() {
  // `adb devices -l` prints: SERIAL  state  key:value ... model:NAME ...
  const lines = adb(['devices', '-l']).split(/\r?\n/).slice(1);
  const devices = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const model = (line.match(/model:(\S+)/) || [])[1] || '';
    devices.push({ serial: parts[0], state: parts[1], model });
  }
  return devices;
}

function pickDevice(devices, wantedSerial) {
  if (wantedSerial) {
    const d = devices.find((x) => x.serial === wantedSerial);
    if (!d) fail(`no device with serial "${wantedSerial}". Attached: ${devices.map((x) => x.serial).join(', ') || 'none'}`);
    if (d.state !== 'device') fail(`device "${wantedSerial}" is "${d.state}". Unlock it and accept the USB debugging prompt.`);
    return d;
  }
  const ready = devices.filter((d) => d.state === 'device');
  const unauthorized = devices.filter((d) => d.state === 'unauthorized');
  if (ready.length === 0) {
    if (unauthorized.length) {
      fail('the device is unauthorized. Accept the "Allow USB debugging" prompt on the glasses, then retry.');
    }
    fail(
      'no adb device found. Check that:\n' +
        '  - the glasses are connected by USB and powered on\n' +
        '  - Developer Mode is on (via the vendor companion app)\n' +
        '  - "adb devices" lists a device with state "device"'
    );
  }
  const glasses = ready.find((d) => d.model === GLASSES_MODEL);
  if (glasses) return glasses;
  if (ready.length === 1) {
    console.log(`Note: no ${GLASSES_MODEL} found; using the only device (${ready[0].serial}, model "${ready[0].model || 'unknown'}").`);
    return ready[0];
  }
  fail(
    `${ready.length} devices attached and none is ${GLASSES_MODEL}. Re-run with --serial <id>:\n` +
      ready.map((d) => `  ${d.serial}  model=${d.model || 'unknown'}`).join('\n')
  );
}

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const pageUrl = buildUrl(opts.url, opts.mirror);

  if (!existsSync(APK)) {
    fail(
      `prebuilt APK not found at ${APK}.\n` +
        'Build it first (see android-wrapper/README.md) and copy the debug APK to that path.'
    );
  }

  step(1, 'Checking adb');
  try {
    const v = adb(['version']).split(/\r?\n/)[0];
    console.log(`  ${v}`);
  } catch {
    fail(
      'adb not found. Install Android platform-tools and either add them to PATH, ' +
        'or set ADB to the full path of adb (e.g. C:\\Android\\platform-tools\\adb.exe).'
    );
  }

  step(2, 'Finding the glasses');
  const device = pickDevice(listDevices(), opts.serial);
  const s = device.serial;
  console.log(`  using ${s} (model ${device.model || 'unknown'})`);

  step(3, `Forwarding device port ${PORT} to this computer (adb reverse)`);
  adb(['-s', s, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  console.log(`  glasses can now reach http://localhost:${PORT} (your web app)`);

  step(4, 'Installing the wrapper APK');
  const out = adb(['-s', s, 'install', '-r', APK]);
  console.log(`  ${out.trim().split(/\r?\n/).pop()}`);

  step(5, 'Granting camera and microphone permissions');
  for (const perm of PERMISSIONS) {
    try {
      adb(['-s', s, 'shell', `pm grant ${PACKAGE} ${perm}`]);
      console.log(`  granted ${perm}`);
    } catch (err) {
      console.log(`  WARNING: could not grant ${perm}: ${err.message}`);
      console.log('  The page can still run; camera or mic will just be denied.');
    }
  }

  step(6, `Launching the app at ${pageUrl}`);
  // Sent as one string so the device shell keeps the quotes and does not glob the "?".
  const cmd = `am start -n ${ACTIVITY} -e url '${pageUrl.replace(/'/g, '')}'`;
  const started = adb(['-s', s, 'shell', cmd]);
  if (/Error|Exception/i.test(started)) fail(`the app did not start:\n${started}`);
  console.log(`  ${started.trim().split(/\r?\n/).join('\n  ')}`);

  console.log(`
Done. Next steps (plain English):
  1. Look at the glasses. You should see the web app on a black background.
  2. If it shows "Cannot reach the app", start the web app on this computer
     (port ${PORT}), then run this script again.
  3. To see which buttons do what, run in another terminal:
       node scripts/m6-logcat.mjs --serial ${s}
     and press the ring and tap the touchpad. Follow scripts/m6-keys.md.
`);
}

main();
