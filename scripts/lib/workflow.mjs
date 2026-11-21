// Pure helpers for ship / rollback / pre-push / last-known-good. No I/O here so they can be unit tested.

export const LKG_TAG = 'last-known-good';
const ZERO = /^0+$/;

/** A commit message must say something a human can read later. Returns {ok, message}. */
export function validateMessage(msg) {
  const m = (msg ?? '').trim();
  if (!m) return { ok: false, message: 'Add a message in quotes saying what you changed, for example: npm run ship -- "Fix the allergy banner text"' };
  if (m.length < 8) return { ok: false, message: `"${m}" is too short. Describe the change in a few words so the team can follow along.` };
  if (m.length > 200) return { ok: false, message: 'That message is very long. Keep it to one line (under 200 characters).' };
  if (/^(wip|fix|update|changes?|stuff|test|asdf|\.+)$/i.test(m)) return { ok: false, message: `"${m}" says nothing. Describe what changed.` };
  return { ok: true, message: m };
}

/** git@github.com:o/r.git, https://github.com/o/r(.git), ssh://git@github.com/o/r -> {host, owner, repo} or null. */
export function parseRemote(url) {
  const u = (url ?? '').trim();
  const m = /^(?:git@|ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
  return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

export function actionsUrl(remote) {
  const r = parseRemote(remote);
  return r && r.host === 'github.com' ? `https://github.com/${r.owner}/${r.repo}/actions` : null;
}

/** Where does ship push? The current branch, whatever it is, but never a detached HEAD. */
export function pushTarget(branch) {
  const b = (branch ?? '').trim();
  if (!b || b === 'HEAD') return { ok: false, message: 'You are not on a branch (detached HEAD). Run: git switch main' };
  return { ok: true, branch: b };
}

export function isConflictOutput(text) {
  return /CONFLICT|could not apply|Automatic merge failed|Resolve all conflicts/i.test(text ?? '');
}

/** Arguments for pushing the last-known-good tag. Lease = only overwrite the tag if the remote still has what we saw. */
export function lkgPushArgs(remoteSha) {
  const expect = remoteSha && !ZERO.test(remoteSha) ? remoteSha : '';
  return ['push', 'origin', `refs/tags/${LKG_TAG}`, `--force-with-lease=refs/tags/${LKG_TAG}:${expect}`];
}

/** Move the tag only forward: never to a commit that is older than the current last-known-good. */
export function shouldMoveLkg({ currentIsAncestorOfHead, currentExists }) {
  return !currentExists || currentIsAncestorOfHead;
}

/** pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" lines. */
export function parsePushLines(stdin) {
  return (stdin ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [localRef, localSha, remoteRef, remoteSha] = l.split(/\s+/);
    return { localRef, localSha, remoteRef, remoteSha, isDelete: ZERO.test(localSha ?? ''), isTag: (remoteRef ?? '').startsWith('refs/tags/'), isNew: ZERO.test(remoteSha ?? '') };
  });
}

/** Only branch pushes that add commits need the checks; tag pushes and deletes do not. */
export function needsChecks(pushes) {
  return pushes.some((p) => !p.isTag && !p.isDelete);
}

/** ship already ran the full check on exactly this commit, so the hook may skip the duplicate run. */
export function canSkipPrePush(env, pushes) {
  const v = env.BG_VERIFIED_SHA;
  if (!v) return false;
  const branchPushes = pushes.filter((p) => !p.isTag && !p.isDelete);
  return branchPushes.length > 0 && branchPushes.every((p) => p.localSha === v);
}

export function backupBranchName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `backup/before-rollback-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Hook/ship escape hatches are not for teammates: say so if someone tries. */
export function usesForbiddenFlags(argv) {
  return argv.filter((a) => /^(--no-verify|--force|-f|--force-with-lease|--no-gpg-sign)$/.test(a));
}

/** After `git pull --rebase`: merged code must be re-checked whenever HEAD moved. Unknown HEAD fails closed. */
export function needsRecheckAfterPull(headBefore, headAfter) {
  if (!headBefore || !headAfter) return true;
  return headBefore !== headAfter;
}
