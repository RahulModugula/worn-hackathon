#!/usr/bin/env node
// Preflight for teammates: `npm run doctor`. Prints PASS/WARN/FAIL with a plain-English fix.
// Never prints secret values, only whether an env var is set.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const WIN = process.platform === 'win32';
const installHint = (what) => (what === 'node'
  ? (WIN ? 'winget install OpenJS.NodeJS.LTS' : 'brew install node')
  : (WIN ? 'winget install Google.PlatformTools' : 'brew install android-platform-tools'));

const results = [];
const add = (level, name, fix = '') => results.push({ level, name, fix });
const run = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }); }
  catch { return null; }
};

// Node
const major = Number(process.versions.node.split('.')[0]);
major >= 22 ? add('PASS', `Node ${process.versions.node}`)
  : add('FAIL', `Node ${process.versions.node} is too old`, `Install Node 22 or newer (${installHint('node')}).`);

// Dependencies and build
existsSync('node_modules') ? add('PASS', 'Dependencies installed')
  : add('FAIL', 'node_modules missing', 'Run: npm ci');
existsSync('dist/index.html') ? add('PASS', 'Production build exists (dist/)')
  : add('WARN', 'No production build yet', 'Run: npm run build');

// Env (names only)
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const has = (k) => Boolean(process.env[k]) || new RegExp(`^${k}=.+`, 'm').test(env);
has('GEMINI_API_KEY') ? add('PASS', 'GEMINI_API_KEY is set')
  : add('WARN', 'GEMINI_API_KEY not set', 'OK for the demo: wound assessment uses the built-in fallback answer.');
has('DEEPGRAM_API_KEY') ? add('PASS', 'DEEPGRAM_API_KEY is set')
  : add('WARN', 'DEEPGRAM_API_KEY not set', 'OK: voice falls back to browser speech or tap/keyboard.');

// Confidential kit must not be tracked
const tracked = run('git', ['ls-files', 'kit']);
tracked === null ? add('WARN', 'Could not run git')
  : tracked.trim() === '' ? add('PASS', 'kit/ is not tracked by git')
  : add('FAIL', 'kit/ files are tracked by git!', 'STOP. Run: git rm -r --cached kit  and tell the team lead. Never push this.');

// Secrets in tracked files (patterns only)
const grep = run('git', ['grep', '-nIE', 'AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}', '--', '.', ':!package-lock.json']);
grep && grep.trim() ? add('FAIL', 'Possible API key committed', 'Remove it, rotate the key, tell the team lead.')
  : add('PASS', 'No API-key patterns in tracked files');

// adb and glasses
const adbv = run('adb', ['version']);
if (!adbv) {
  add('WARN', 'adb not installed', `Only needed to install on the glasses: ${installHint('adb')}, then reopen the terminal.`);
} else {
  add('PASS', 'adb installed');
  const devs = (run('adb', ['devices', '-l']) || '').split('\n').slice(1).filter((l) => l.trim());
  const glass = devs.filter((l) => /XNM_Glass/i.test(l));
  if (glass.length) add('PASS', 'Glasses connected over adb');
  else if (devs.length) add('WARN', 'A device is connected but it is not the glasses', 'Unplug other phones, or check the glasses cable.');
  else add('WARN', 'No glasses on adb', 'Turn on Developer Mode with the vendor companion app, replug the glasses USB cable, accept the prompt on the glasses. See docs/TEAMMATE-GUIDE.md.');
}

// Server
try {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3001}/api/health`, { signal: AbortSignal.timeout(2000) });
  const j = await res.json();
  add('PASS', `Server is running (gemini:${j.gemini}, deepgram:${j.deepgram})`);
} catch {
  add('WARN', 'Server is not running on this machine', 'Run: npm run build && npm start   (or npm run dev)');
}

const icon = { PASS: 'OK  ', WARN: 'WARN', FAIL: 'FAIL' };
for (const r of results) console.log(`${icon[r.level]}  ${r.name}${r.fix ? `\n      -> ${r.fix}` : ''}`);
const fails = results.filter((r) => r.level === 'FAIL').length;
console.log(fails ? `\n${fails} problem(s) to fix first.` : '\nNo blockers.');
process.exit(fails ? 1 : 0);
