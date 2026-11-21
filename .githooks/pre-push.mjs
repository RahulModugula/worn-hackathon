// pre-push: runs on EVERY push (including main) and refuses only when something is actually broken.
// Teammates push straight to main; these checks are the safety net. `git push --no-verify` is not allowed for teammates.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { canSkipPrePush, needsChecks, parsePushLines } from '../scripts/lib/workflow.mjs';
import { protectedChanges } from '../scripts/lib/protected.mjs';

const isWin = process.platform === 'win32';

let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
const pushes = parsePushLines(stdin);

if (!needsChecks(pushes)) process.exit(0); // tag push or branch delete: nothing to check
if (canSkipPrePush(process.env, pushes)) {
  console.log('pre-push: `npm run ship` already verified this exact commit. Pushing.');
  process.exit(0);
}

const changed = [];
for (const p of pushes.filter((x) => !x.isTag && !x.isDelete)) {
  const range = p.isNew ? `${p.localSha}~1..${p.localSha}` : `${p.remoteSha}..${p.localSha}`;
  const r = spawnSync('git', ['diff', '--name-only', range], { encoding: 'utf8' });
  if (r.status === 0) changed.push(...r.stdout.split('\n').filter(Boolean));
}
for (const h of protectedChanges(changed)) {
  console.log(`pre-push: you changed a protected area (${h.prefix}): ${h.why}. Its tests must pass: ${h.tests.join(', ')}`);
}

console.log('pre-push: running the safety checks (about 10-60 seconds). Do not interrupt.');
const base = pushes.find((p) => !p.isNew && !p.isTag && !p.isDelete)?.remoteSha;
const env = { ...process.env, ...(base ? { GUARD_BASE: base } : {}) };
const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'check'], { stdio: 'inherit', shell: isWin, env });
if (r.status !== 0) {
  console.error('\nPUSH BLOCKED: the checks above failed, so this change would break the demo for everyone.');
  console.error('What to do: read the first error above, fix it (or paste it to your AI assistant: "fix this without weakening any test or guard"), commit, push again.');
  console.error('Do not use --no-verify. If you are stuck, run `npm run rollback` to get back to the last working version and ask the lead.');
  process.exit(1);
}
console.log('pre-push: all checks passed. Pushing.');
