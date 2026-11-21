#!/usr/bin/env node
// Moves the `last-known-good` tag to HEAD (local, then origin with a lease). Called by `npm run ship` after a fully green run,
// and by the optional CI job. Only ever moves the tag FORWARD. Works offline: the local tag still moves.
import { git } from './lib/proc.mjs';
import { LKG_TAG, lkgPushArgs, shouldMoveLkg } from './lib/workflow.mjs';

const head = git(['rev-parse', 'HEAD']).out;
const ls = git(['ls-remote', '--tags', 'origin', `refs/tags/${LKG_TAG}`]);
const online = ls.code === 0;
const remoteSha = online ? ls.out.split(/\s+/)[0] || '' : '';
const local = git(['rev-parse', '-q', '--verify', `refs/tags/${LKG_TAG}`]).out;
const current = remoteSha || local;
let currentIsAncestorOfHead = false;
if (current) {
  if (remoteSha) git(['fetch', '-q', 'origin', `+refs/tags/${LKG_TAG}:refs/tags/${LKG_TAG}`]);
  currentIsAncestorOfHead = git(['merge-base', '--is-ancestor', current, head]).code === 0;
}
if (!shouldMoveLkg({ currentExists: Boolean(current), currentIsAncestorOfHead })) {
  console.log(`last-known-good NOT moved: it points at a commit that is not an ancestor of this one (${current.slice(0, 7)}). Someone else's newer green version is already there.`);
  process.exit(0);
}
git(['tag', '-f', LKG_TAG, head]);
console.log(`last-known-good now points at ${head.slice(0, 7)} (local).`);
if (!online) { console.log('Offline or no remote: the tag will be pushed next time you run `npm run ship`.'); process.exit(0); }
const p = git(lkgPushArgs(remoteSha));
if (p.code !== 0) { console.log(`Could not push the last-known-good tag (${p.err.split('\n').pop()}). The local tag is set; this is not fatal.`); process.exit(0); }
console.log('last-known-good pushed to origin.');
