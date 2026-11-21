// Protected paths are NOT blocked. Touching them means their invariant tests must pass (pre-push runs the whole suite anyway).
export const PROTECTED = [
  { prefix: 'server/', why: 'sync server: first-write-wins, synchronous applyAction, idempotent ids', tests: ['server/sessionStore.test.ts', 'server/ws.test.ts'] },
  { prefix: 'shared/', why: 'types and clock imported by both server and app', tests: ['shared/clock.test.ts'] },
  { prefix: 'src/hud-kit/', why: 'generic HUD kit: no Bedside Glance words, no imports from apps', tests: ['src/hud-kit/hud-kit.test.tsx', 'scripts/check-hud-boundary.mjs'] },
  { prefix: 'docs/FRD-v2.2.md', why: 'the spec; display copy must match it verbatim', tests: ['src/apps/bedside-glance/glasses/copyAudit.test.ts'] },
  { prefix: 'src/apps/bedside-glance/glasses/', why: 'glasses screens: display law and FRD copy', tests: ['src/apps/bedside-glance/glasses/copyAudit.test.ts'] },
  { prefix: 'scripts/', why: 'the guardrails themselves', tests: ['scripts/guardrails.test.ts'] },
  { prefix: '.githooks/', why: 'the pre-push guard', tests: ['scripts/guardrails.test.ts'] },
  { prefix: '.github/', why: 'CI and repo policy', tests: ['scripts/guardrails.test.ts'] },
  { prefix: 'CLAUDE.md', why: 'rules every AI session reads', tests: ['scripts/guardrails.test.ts'] },
];
export function protectedChanges(changed) {
  const hits = [];
  for (const p of PROTECTED) {
    const files = changed.filter((f) => f.startsWith(p.prefix) || f.endsWith('/' + p.prefix));
    if (files.length) hits.push({ ...p, files });
  }
  return hits;
}
