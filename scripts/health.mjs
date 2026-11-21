#!/usr/bin/env node
// npm run health  (alias: npm run demo:check). Run it any time. Prints PASS / WARN / FAIL with a plain-English fix.
// Add --full to also run the end-to-end browser test. Add --fast to skip the slow parts (check + smoke).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateFreeze, FREEZE_AT } from './freeze-guard.mjs';
import { git, runInherit } from './lib/proc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const argv = process.argv.slice(2);
const rows = [];
const row = (level, what, fix = '') => { rows.push({ level, what, fix }); console.log(`${level.padEnd(4)} ${what}${fix && level !== 'PASS' ? `\n     fix: ${fix}` : ''}`); };

const need = JSON.parse(readFileSync('package.json', 'utf8')).engines?.node ?? '>=22.12';
const [maj, min] = process.versions.node.split('.').map(Number);
const [nm, nn] = need.replace(/[^\d.]/g, '').split('.').map(Number);
maj > nm || (maj === nm && min >= (nn ?? 0)) ? row('PASS', `Node ${process.versions.node} (needs ${need})`) : row('FAIL', `Node ${process.versions.node} is too old (needs ${need})`, 'Install the current Node LTS from nodejs.org (Windows: winget install OpenJS.NodeJS.LTS), reopen the terminal.');

existsSync('node_modules/vite') && existsSync('node_modules/vitest') ? row('PASS', 'Dependencies are installed') : row('FAIL', 'Dependencies are missing', 'Run: npm ci');

const hp = git(['config', '--get', 'core.hooksPath']).out;
hp === '.githooks' ? row('PASS', 'Safety hook is installed (git push runs the checks)') : row('FAIL', 'The git push safety hook is NOT installed', 'Run: node scripts/install-hooks.mjs   (or npm ci)');

if (git(['remote', 'get-url', 'origin']).code === 0) {
  const f = git(['fetch', '-q', 'origin']);
  const br = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const lr = git(['rev-list', '--left-right', '--count', `origin/${br}...HEAD`]);
  if (f.code !== 0) row('WARN', 'Could not reach GitHub (offline?). Everything else still works locally', 'Reconnect when you can; ship needs the internet to push.');
  else if (lr.code === 0) {
    const [behind, ahead] = lr.out.split(/\s+/).map(Number);
    behind > 0 ? row('WARN', `Your branch is ${behind} commit(s) behind origin/${br}`, 'Run: git pull --rebase   (npm run ship does this for you)') : row('PASS', `Branch ${br} is up to date with origin${ahead ? ` (${ahead} commit(s) not pushed yet)` : ''}`);
  } else row('WARN', `No origin/${br} to compare with`, 'Fine for a new branch.');
} else row('WARN', 'No git remote named origin', 'Fine locally; ship cannot push without one.');

const dirty = git(['status', '--porcelain']).out;
row('PASS', dirty ? `${dirty.split('\n').length} file(s) changed but not shipped yet` : 'Working copy is clean');

const fz = evaluateFreeze(new Date(), [], FREEZE_AT, process.env);
fz.ok ? row('PASS', fz.message) : row('WARN', 'The freeze has passed: ship and CI will refuse new changes', 'Only the lead can grant an exception.');

const lkg = git(['rev-parse', '-q', '--verify', 'last-known-good']).out;
lkg ? row('PASS', `last-known-good exists (${lkg.slice(0, 7)}); \`npm run rollback\` can restore it`) : row('WARN', 'No last-known-good tag yet', 'It is created the first time `npm run ship` finishes green.');

if (!argv.includes('--fast')) {
  console.log('\nRunning the full check (types, boundary, guards, docs, build, tests)...');
  runInherit('npm', ['run', 'check']) === 0 ? row('PASS', 'npm run check is green') : row('FAIL', 'npm run check failed (first error is above)', 'Paste the first error to your AI assistant: "fix this without weakening any test or guard". Still stuck: npm run rollback.');
  console.log('\nProduction smoke test + fallback drill...');
  const s = runInherit('node', ['scripts/smoke.mjs']);
  s === 0 ? row('PASS', 'Production smoke test + no-key fallback drill + display law are green') : s === 2 ? row('WARN', 'Smoke test skipped: no Chrome found', 'Install Google Chrome, or set CHROME_PATH to its chrome.exe / binary.') : row('FAIL', 'Smoke test failed (see the FAIL line above)', 'The app does not load cleanly. Try npm run rollback, then tell the lead.');
  if (argv.includes('--full') && s !== 2) {
    runInherit('npm', ['run', 'e2e']) === 0 ? row('PASS', 'End-to-end test is green') : row('FAIL', 'End-to-end test failed', 'See the output above; ask the lead.');
  }
}

const fails = rows.filter((r) => r.level === 'FAIL').length;
const warns = rows.filter((r) => r.level === 'WARN').length;
console.log(`\n${fails ? 'NOT HEALTHY' : 'HEALTHY'}: ${rows.filter((r) => r.level === 'PASS').length} pass, ${warns} warn, ${fails} fail.`);
process.exit(fails ? 1 : 0);
