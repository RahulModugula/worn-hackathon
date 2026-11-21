// Diff-based guardrails. Pure: they take a unified diff (git diff --unified=0) or parsed data, return problem strings.
// A line may opt out of the weakening checks by carrying a "skip-reason:" comment that says why.
import { createHash } from 'node:crypto';

/** Parse `git diff --unified=0` text into [{path, deleted, added:[text], removed:[text]}]. */
export function parseDiff(text) {
  const files = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: '', deleted: false, added: [], removed: [] };
      files.push(cur);
      const m = / b\/(.+)$/.exec(line);
      if (m) cur.path = m[1];
    } else if (!cur) continue;
    else if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('+++ ')) { if (line !== '+++ /dev/null') cur.path = line.slice(4).replace(/^b\//, ''); }
    else if (line.startsWith('--- ')) { if (cur.deleted || !cur.path) cur.path = cur.path || line.slice(4).replace(/^a\//, ''); }
    else if (line.startsWith('+')) cur.added.push(line.slice(1));
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return files;
}

const isTest = (p) => /\.test\.[cm]?[jt]sx?$/.test(p) || /(^|\/)e2e\//.test(p);
const hasReason = (l) => /skip-reason:/i.test(l);
const num = (s) => Number(s);

// 1. Test-weakening detector
export function checkWeakening(files) {
  const out = [];
  for (const f of files) {
    if (f.deleted && isTest(f.path)) out.push(`${f.path}: a test file was deleted (if intended, say why in the commit and use the lead's go-ahead)`);
    for (const l of f.added) {
      if (hasReason(l)) continue;
      if (isTest(f.path) && /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\(/.test(l)) out.push(`${f.path}: added a skipped/focused/todo test: ${l.trim()}`);
      if (/@ts-expect-error|@ts-ignore|@ts-nocheck|eslint-disable/.test(l)) out.push(`${f.path}: added a check suppression (${l.trim().slice(0, 60)}). Fix the cause, or add "// skip-reason: <why>"`);
    }
    if (isTest(f.path) && !f.deleted) {
      const count = (arr) => arr.filter((l) => /\bexpect\(|\bassert\b/.test(l)).length;
      const lost = count(f.removed) - count(f.added);
      if (lost > 0 && !f.added.some(hasReason)) out.push(`${f.path}: ${lost} more expect( line(s) removed than added. Tests must not get weaker`);
    }
    if (f.deleted && /^src\/.*\.test\.|^server\/.*\.test\./.test(f.path)) continue;
    // coverage thresholds (lower = weaker) and budgets (higher = weaker)
    const pairs = (re) => {
      const grab = (arr) => { const m = new Map(); for (const l of arr) for (const x of l.matchAll(re)) m.set(x[1], num(x[2])); return m; };
      return [grab(f.removed), grab(f.added)];
    };
    if (/vite\.config\.[cm]?[jt]s$/.test(f.path)) {
      const [r, a] = pairs(/\b(statements|branches|functions|lines)\s*:\s*(\d+(?:\.\d+)?)/g);
      for (const [k, v] of a) if (r.has(k) && v < r.get(k) && !f.added.some(hasReason)) out.push(`${f.path}: coverage threshold "${k}" lowered ${r.get(k)} -> ${v}`);
    }
    if (/check-budgets\.[cm]?js$/.test(f.path)) {
      const [r, a] = pairs(/\b(BUDGET_\w+)\s*=\s*(\d+)/g);
      for (const [k, v] of a) if (r.has(k) && v > r.get(k) && !f.added.some(hasReason)) out.push(`${f.path}: budget "${k}" raised ${r.get(k)} -> ${v}`);
    }
  }
  return out;
}

// 2. env / secret guard (names only; value patterns live in guardrails.mjs scanSecrets)
export function checkEnvNames(entries, stagedPaths = []) {
  const out = [];
  for (const p of stagedPaths) if (/(^|\/)\.env(\..+)?$/.test(p) && !/\.env\.example$/.test(p)) out.push(`${p}: env files must never be committed`);
  for (const { path, text } of entries) {
    for (const m of text.matchAll(/\bVITE_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*/g)) {
      out.push(`${path}: "${m[0]}" would be baked into the public browser bundle (VITE_ vars are public). Keep keys server-side`);
    }
  }
  return out;
}

// 3. Hidden characters in added lines (Trojan Source, CVE-2021-42574; zero-width tricks)
const HIDDEN = /[‪-‮⁦-⁩​-‍﻿]/;
export function checkHiddenChars(files) {
  const out = [];
  for (const f of files) f.added.forEach((l) => {
    const m = HIDDEN.exec(l);
    if (m) out.push(`${f.path}: hidden character U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} in added line: ${JSON.stringify(l.slice(0, 50))}`);
  });
  return out;
}

// 4. Dependency churn
export const BANNED_PACKAGES = [/^firebase(-admin)?$/, /^@firebase\//, /^tailwindcss$/, /^bootstrap$/, /^bulma$/, /^@mui\//, /^@chakra-ui\//, /^antd$/, /^styled-components$/, /^@emotion\//];
const DEP_LINE = /^\s*"([@\w./-]+)"\s*:\s*"([\^~<>=*]|\d|latest|git|http|file:|npm:)[^"]*"\s*,?\s*$/;
export function depNames(lines) { return lines.map((l) => DEP_LINE.exec(l)?.[1]).filter(Boolean); }
export function checkDependencies(files, { approved = false } = {}) {
  const out = [];
  const pj = files.find((f) => f.path === 'package.json');
  const lock = files.find((f) => f.path === 'package-lock.json');
  const added = pj ? depNames(pj.added) : [];
  const removed = pj ? depNames(pj.removed) : [];
  const changed = added.length + removed.length > 0;
  if (changed && !lock) out.push('package.json dependencies changed but package-lock.json did not. Run npm install and commit both');
  if (lock && !pj && lock.added.length + lock.removed.length > 0) out.push('package-lock.json changed but package.json did not. Revert the lockfile unless you meant to change dependencies');
  const fresh = added.filter((n) => !removed.includes(n));
  if (fresh.length && !approved) out.push(`new dependencies (${fresh.join(', ')}) need approval: ask the lead, then push with DEPS_APPROVED=1 or put "deps-approved" in the commit message`);
  for (const n of added) if (BANNED_PACKAGES.some((re) => re.test(n))) out.push(`package.json: "${n}" is banned (no Firebase, no CSS frameworks; see CLAUDE.md)`);
  return out;
}
export function checkBannedInManifest(pkg) {
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  return names.filter((n) => BANNED_PACKAGES.some((re) => re.test(n))).map((n) => `package.json: "${n}" is banned`);
}

// 5. New hard-coded hosts in src/ and shared/
const BUILTIN_HOSTS = [/^localhost$/, /^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /^(?:10|192\.168)\.[\d.x]+$/, /^172\.(?:1[6-9]|2\d|3[01])\.[\d.x]+$/, /^www\.w3\.org$/, /^example\.(?:com|org)$/, /\.onrender\.com$/];
export function checkNewHosts(files, allowedHosts = []) {
  const out = [];
  for (const f of files) {
    if (!/^(?:src|shared)\//.test(f.path) || isTest(f.path)) continue;
    for (const l of f.added) for (const m of l.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const h = m[1].toLowerCase();
      if (BUILTIN_HOSTS.some((re) => re.test(h)) || allowedHosts.some((a) => h === a || h.endsWith('.' + a))) continue;
      out.push(`${f.path}: new external host "${h}". Add it to scripts/guard-allowlist.json (hosts) after the lead agrees, and make sure there is an offline fallback`);
    }
  }
  return out;
}

// 6. Injection tripwire for instruction/doc files
export const INSTRUCTION_FILE = /(^|\/)(CLAUDE\.md|AGENTS\.md|README\.md|\.cursorrules|copilot-instructions\.md)$|^docs\/.*\.md$/;
const TRIPWIRES = [
  [/ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts)/i, 'an instruction-override phrase'],
  [/disregard\s+(?:the\s+|all\s+|your\s+)?(?:system|previous|prior|above)/i, 'an instruction-override phrase'],
  [/\byou\s+are\s+now\s+(?:a|an|in)\b/i, 'a role-reassignment phrase'],
  [/do\s+not\s+(?:tell|inform|mention\s+to)\s+the\s+user/i, 'a hide-from-user phrase'],
  [/\b(?:reveal|print|exfiltrate|send)\b.{0,40}\b(?:system\s+prompt|api[_ ]?key|secrets?|credentials)\b/i, 'a secret-exfiltration phrase'],
  [/(?:curl|wget)\s[^|\n]*\|\s*(?:ba|z)?sh\b/i, 'a pipe-to-shell command'],
  [/<!--/, 'a hidden HTML comment'],
  [/[A-Za-z0-9+/]{80,}={0,2}/, 'a long base64-like blob'],
];
export function checkInjection(files, allow = []) {
  const out = [];
  for (const f of files) {
    if (!INSTRUCTION_FILE.test(f.path)) continue;
    for (const l of f.added) for (const [re, what] of TRIPWIRES) {
      if (!re.test(l)) continue;
      if (allow.some((a) => a.path === f.path && l.includes(a.contains))) continue;
      out.push(`${f.path}: ${what} in an instruction/doc file: ${JSON.stringify(l.trim().slice(0, 70))}. AI agents read these files, so a human must review. If legitimate, add a reviewed entry to scripts/guard-allowlist.json (injection)`);
    }
  }
  return out;
}

// 7. Kit confidentiality (fingerprints live only in memory)
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GENERIC_NAMES = new Set(['readme.md', 'index.html', 'package.json', 'license', 'license.txt', '.ds_store', 'contents.json', 'info.plist']);
export function kitFingerprint(files) {
  const hashes = new Set(), names = new Set(), lines = new Set();
  for (const { rel, bytes } of files) {
    const base = rel.split('/').pop().toLowerCase();
    if (base.length >= 10 && !GENERIC_NAMES.has(base)) names.add(base);
    if (bytes.length >= 200) hashes.add(sha(bytes));
    if (bytes.length < 3_000_000 && !bytes.includes(0)) for (const l of bytes.toString('utf8').split('\n')) { const t = l.trim(); if (t.length >= 60) lines.add(sha(t)); }
  }
  return { hashes, names, lines };
}
export function checkAgainstKit(fp, files, readBytes) {
  const out = [];
  for (const f of files) {
    const base = f.path.split('/').pop().toLowerCase();
    if (fp.names.has(base)) out.push(`${f.path}: has the same file name as a file in kit/ (the kit is confidential)`);
    const b = f.deleted ? null : readBytes(f.path);
    if (b && b.length >= 200 && fp.hashes.has(sha(b))) out.push(`${f.path}: is byte-identical to a file in kit/`);
    for (const l of f.added) { const t = l.trim(); if (t.length >= 60 && fp.lines.has(sha(t))) { out.push(`${f.path}: contains a line copied verbatim from kit/`); break; } }
  }
  return out;
}
