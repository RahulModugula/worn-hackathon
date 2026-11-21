#!/usr/bin/env node
// Runs from `npm run prepare` (after npm install/ci). Points git at .githooks/. Must NEVER fail npm: CI, no .git, no git, all fine.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function install(root = ROOT, env = process.env) {
  if (env.CI) return 'skipped (CI)';
  if (!existsSync(path.join(root, '.git')) || !existsSync(path.join(root, '.githooks'))) return 'skipped (not a git checkout)';
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
    try { chmodSync(path.join(root, '.githooks', 'pre-push'), 0o755); } catch { /* Windows */ }
    return 'installed (git push now runs the safety checks)';
  } catch {
    return 'skipped (git not available)';
  }
}

if (/install-hooks\.mjs$/.test(process.argv[1] ?? '')) {
  try { console.log(`git hooks: ${install()}`); } catch (e) { console.log(`git hooks: skipped (${e.message})`); }
  process.exit(0);
}
