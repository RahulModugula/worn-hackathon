#!/usr/bin/env node
// Freeze guard: after the hackathon freeze, PR checks fail unless the PR has the `freeze-exception` label.
// Usage in CI: node scripts/freeze-guard.mjs --labels "$LABELS"   (comma separated; may be empty)
import { pathToFileURL } from 'node:url';

export const FREEZE_AT = '2026-11-21T19:00:00Z'; // Sat Nov 21 2026 2:00 PM EST
export const EXCEPTION_LABEL = 'freeze-exception';

/** Pure: now is injected (Date or ms). Returns {ok, message}. */
export function evaluateFreeze(now, labels = [], freezeAt = FREEZE_AT, env = {}) {
  if (env.FREEZE_EXCEPTION === '1') labels = [...labels, EXCEPTION_LABEL];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const freezeMs = Date.parse(freezeAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(freezeMs)) return { ok: false, message: 'freeze guard: cannot read the time, failing closed' };
  if (nowMs < freezeMs) return { ok: true, message: `Before the freeze (${freezeAt}): OK` };
  if (labels.map((l) => l.trim()).includes(EXCEPTION_LABEL)) return { ok: true, message: `Past the freeze, but label "${EXCEPTION_LABEL}" is set: OK` };
  return { ok: false, message: `The freeze (${freezeAt}) has passed. Late edits are not accepted. Ask the lead for an exception (label "${EXCEPTION_LABEL}" in CI, or FREEZE_EXCEPTION=1 locally) if this is truly needed.` };
}

export function parseLabels(arg) {
  return (arg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--labels');
  const labels = parseLabels(i >= 0 ? process.argv[i + 1] : '');
  const r = evaluateFreeze(new Date(), labels, FREEZE_AT, process.env);
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
