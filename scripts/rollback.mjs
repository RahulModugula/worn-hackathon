#!/usr/bin/env node
// npm run rollback [-- --push] [-- --yes] [-- --to <commit-or-tag>]
// Puts the files back exactly as they were at the last-known-good version, as a NEW commit (no force-push, history kept).
// Works offline from local git. Your current state is saved first on a backup/ branch, so nothing is lost.
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, runInherit } from './lib/proc.mjs';
import { LKG_TAG, backupBranchName, pushTarget } from './lib/workflow.mjs';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const ti = argv.indexOf('--to');
const target = ti >= 0 ? argv[ti + 1] : LKG_TAG;
const die = (s) => { console.error(`\nSTOPPED. ${s}`); process.exit(1); };

if (git(['remote', 'get-url', 'origin']).code === 0 && target === LKG_TAG) git(['fetch', '-q', 'origin', `+refs/tags/${LKG_TAG}:refs/tags/${LKG_TAG}`]); // offline: ignore failure
const sha = git(['rev-parse', '-q', '--verify', `${target}^{commit}`]).out;
if (!sha) die(`There is no "${target}" yet. It is created the first time \`npm run ship\` finishes green. To pick a version by hand: git log --oneline, then npm run rollback -- --to <commit>.`);
const branch = pushTarget(git(['rev-parse', '--abbrev-ref', 'HEAD']).out);
if (!branch.ok) die(branch.message);

const head = git(['rev-parse', 'HEAD']).out;
const same = git(['diff', '--quiet', sha, 'HEAD']).code === 0 && git(['status', '--porcelain']).out === '';
if (same) { console.log(`Nothing to do: your files already match ${target} (${sha.slice(0, 7)}).`); process.exit(0); }

const subject = git(['log', '-1', '--format=%s (%cr)', sha]).out;
console.log(`This will make the files on "${branch.branch}" identical to ${target}: ${sha.slice(0, 7)} "${subject}".`);
console.log('Everything done since then (including uncommitted work) is saved first on a backup branch, so you can get it back.');
if (!flag('--yes')) {
  if (!process.stdin.isTTY) die('Add --yes to confirm (this was not run from an interactive terminal).');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('Type yes to roll back: ')).trim().toLowerCase();
  rl.close();
  if (a !== 'yes' && a !== 'y') die('Cancelled. Nothing changed.');
}

const backup = backupBranchName(new Date());
git(['branch', backup, head]);
let stashed = false;
if (git(['status', '--porcelain']).out) {
  stashed = git(['stash', 'push', '-u', '-m', `before ${backup}`]).code === 0;
}
const rt = git(['read-tree', '-u', '--reset', sha]);
if (rt.code !== 0) die(`Git could not restore the files: ${rt.err}. Your work is safe on ${backup}.`);
const c = git(['commit', '-m', `Rollback to ${target} (${sha.slice(0, 7)})`]);
if (c.code !== 0) die(`Could not commit the rollback: ${c.err || c.out}. Your work is safe on ${backup}.`);

console.log(`\nDONE. Files now match ${target} (${sha.slice(0, 7)}). Your previous state is on branch ${backup}${stashed ? ' and your uncommitted edits are in `git stash list`' : ''}.`);
if (flag('--push')) {
  if (runInherit('npm', ['run', 'check']) !== 0) die('The rollback target itself fails the checks, so it was not pushed. Ask the lead.');
  const code = runInherit('git', ['push'], { env: { ...process.env, BG_VERIFIED_SHA: git(['rev-parse', 'HEAD']).out } });
  console.log(code === 0 ? 'Pushed. Everyone who runs `git pull` gets the working version.' : 'The push failed (offline, or a teammate pushed first). Run: git pull --rebase, then npm run rollback -- --push again.');
} else {
  console.log('To share it with the team run: npm run rollback -- --push   (a plain git push would be refused by the guard because the rollback removes tests that were added later).');
}
