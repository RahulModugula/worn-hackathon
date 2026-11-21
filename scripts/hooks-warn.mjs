#!/usr/bin/env node
// Runs before `npm start` / `npm run dev`. Warns (never fails) when the git push safety hook is not installed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

try {
  if (existsSync('.git') && !process.env.CI) {
    let hp = '';
    try { hp = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* unset */ }
    if (hp !== '.githooks') console.warn('\n!! WARNING: the git push safety hook is not installed on this machine. Run: node scripts/install-hooks.mjs\n');
  }
} catch { /* never block startup */ }
