#!/usr/bin/env node
// npm run ship -- "what you changed"
// Checks everything locally, commits, pulls the latest, re-checks, pushes the CURRENT branch (main by default),
// and marks the version as last-known-good. Plain-English output. Windows-safe (node only).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateFreeze, FREEZE_AT } from './freeze-guard.mjs';
import { git, runInherit, runCapture } from './lib/proc.mjs';
import { actionsUrl, isConflictOutput, pushTarget, usesForbiddenFlags, validateMessage } from './lib/workflow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const say = (s) => console.log(s);
const die = (s) => { console.error(`\nSTOPPED. ${s}`); process.exit(1); };

const argv = process.argv.slice(2);
const bad = usesForbiddenFlags(argv);
if (bad.length) die(`${bad.join(' ')} is not allowed here. The checks protect the demo; fix what they report instead.`);
const quick = argv.includes('--quick');
const msg = validateMessage(argv.filter((a) => !a.startsWith('--')).join(' '));
if (!msg.ok) die(msg.message);

const fz = evaluateFreeze(new Date(), [], FREEZE_AT, process.env);
if (!fz.ok) die(fz.message);

const branch = pushTarget(git(['rev-parse', '--abbrev-ref', 'HEAD']).out);
if (!branch.ok) die(branch.message);
if (existsSync('.git/rebase-merge') || existsSync('.git/rebase-apply') || existsSync('.git/MERGE_HEAD')) die('A merge or rebase is half-finished. Ask your AI assistant to finish or abort it (git rebase --abort), then run ship again.');

say(`1/6 Saving your changes on "${branch.branch}"...`);
git(['add', '-A']);

say('2/6 Running all checks (types, tests, build, guards). This takes under a minute...');
process.env.BG_COMMIT_MSG = msg.message;
if (runInherit('npm', ['run', 'check']) !== 0) {
  git(['reset', '-q']);
  die('A check failed (see the first error above). Nothing was committed or pushed. Next step: paste the error to your AI assistant with "fix this without weakening any test", then run ship again. If you are lost, run `npm run rollback`.');
}

const staged = git(['diff', '--cached', '--quiet']).code !== 0;
if (staged) {
  const c = git(['commit', '-m', msg.message]);
  if (c.code !== 0) die(`Git could not commit: ${c.err || c.out}`);
  say(`3/6 Committed: "${msg.message}"`);
} else say('3/6 No new changes to commit (will push any commits you already made).');

say('4/6 Getting the latest from your teammates (git pull --rebase)...');
const hasRemote = git(['remote', 'get-url', 'origin']);
let tipBefore = git(['rev-parse', '-q', '--verify', `origin/${branch.branch}`]).out;
if (hasRemote.code === 0) {
  const pull = runCapture('git', ['pull', '--rebase', 'origin', branch.branch]);
  const text = `${pull.out}\n${pull.err}`;
  if (pull.code !== 0 && !/couldn't find remote ref/i.test(text)) {
    git(['rebase', '--abort']);
    if (isConflictOutput(text)) die(`Your change and a teammate's change edit the same lines. Your work is safe (committed locally, rebase undone). Next step: ask your AI assistant "merge origin/${branch.branch} into my branch and resolve the conflicts keeping both people's intent", run npm run check, then ship again. Or message the teammate.`);
    die(`Could not get the latest: ${text.split('\n').slice(-3).join(' ')}. Check your internet, then run ship again.`);
  }
  const tipAfter = git(['rev-parse', '-q', '--verify', `origin/${branch.branch}`]).out;
  if (tipAfter && tipAfter !== tipBefore) {
    say('    New commits arrived. Re-running the checks on the combined code...');
    if (runInherit('npm', ['run', 'check']) !== 0) die('The combined code fails the checks (a teammate\'s change and yours do not fit together). Nothing was pushed. Ask your AI assistant to fix it, commit, and run ship again.');
  }
}

let fullyVerified = false;
if (quick) say('5/6 --quick: skipping the production smoke test and e2e (last-known-good will NOT be updated).');
else {
  say('5/6 Production smoke test + fallback drill (server on a random port, real browser)...');
  const smoke = runInherit('node', ['scripts/smoke.mjs']);
  if (smoke === 2) say('    No Chrome found on this machine: smoke test and e2e SKIPPED (set CHROME_PATH to enable). last-known-good will still move because every other check passed.');
  else if (smoke !== 0) die('The smoke test failed (see above). Nothing was pushed. The app does not load cleanly; fix that first.');
  else {
    if (runInherit('npm', ['run', 'e2e']) !== 0) die('The end-to-end run failed (see above). Nothing was pushed.');
  }
  fullyVerified = true;
}

say('6/6 Pushing...');
const head = git(['rev-parse', 'HEAD']).out;
const hasUpstream = git(['rev-parse', '--abbrev-ref', `${branch.branch}@{u}`]).code === 0;
const pushArgs = hasUpstream ? ['push'] : ['push', '-u', 'origin', branch.branch];
const push = runInherit('git', pushArgs, { env: { ...process.env, BG_VERIFIED_SHA: head } });
if (push !== 0) die(hasRemote.code === 0 ? 'The push was refused (often because a teammate pushed a second ago). Just run ship again: it will pull and re-check.' : 'There is no "origin" remote, so nothing could be pushed. Your commit is saved locally.');

if (fullyVerified) runInherit('node', ['scripts/lkg-tag.mjs']);

const url = actionsUrl(hasRemote.out);
say(`\nDONE. "${msg.message}" is on ${branch.branch} (${head.slice(0, 7)}), all local checks passed${fullyVerified ? ' and it is marked last-known-good' : ''}.`);
if (url) say(`Optional: GitHub's extra checks run at ${url} (if Actions is off, ignore it; your local checks already passed).`);
say('If something looks wrong later: npm run rollback');
