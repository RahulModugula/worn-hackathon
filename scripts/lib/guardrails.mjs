// Pure guardrail checks. Each takes plain data and returns an array of problem strings (empty = OK).
// scripts/guard.mjs feeds them the real repo; scripts/guardrails.test.ts feeds them bad data to prove they can fail.

export const SIZE_LIMIT = 2 * 1024 * 1024;
// Big files are only allowed in these places (images, the prebuilt APK, the pitch decks).
export const BIG_FILE_ALLOW = [/^android-wrapper\/prebuilt\/[^/]+\.apk$/, /^docs\/(img|decks)\//, /^public\/[^/]+\.(png|jpg|jpeg|webp|gif)$/];
const FORBIDDEN_PATHS = [
  [/^kit\//, 'the confidential SDK kit (kit/)'],
  [/(^|\/)\.env($|\.(?!example$))/, 'an .env file (secrets)'],
  [/^private-notes\//, 'private notes'],
  [/^\.claude\//, 'per-machine .claude config'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/\.zip$/i, 'a zip archive (the SDK kit ships as a zip)'],
  [/^MicroLumin|^Microlumin/i, 'a MicroLumin SDK file'],
];

export function checkTrackedFiles(files, sizeOf) {
  const out = [];
  for (const f of files) {
    for (const [re, what] of FORBIDDEN_PATHS) if (re.test(f)) out.push(`${f}: must not be committed (${what})`);
    const size = sizeOf(f);
    if (size > SIZE_LIMIT && !BIG_FILE_ALLOW.some((re) => re.test(f))) {
      out.push(`${f}: ${(size / 1048576).toFixed(1)} MB is over the 2 MB limit (only images, the APK and decks may be bigger)`);
    }
  }
  return out;
}

// Built from pieces so this file does not trip its own scanner.
const SECRET_PATTERNS = [
  ['Google API key', new RegExp('AI' + 'za[0-9A-Za-z_-]{35}')],
  ['GitHub token', new RegExp('\\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_' + 'pat_[A-Za-z0-9_]{30,})')],
  ['AWS access key id', new RegExp('\\b(?:AK' + 'IA|AS' + 'IA)[0-9A-Z]{16}\\b')],
  ['OpenAI/Anthropic style key', new RegExp('\\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}')],
  ['private key block', new RegExp('-----BEGIN (?:[A-Z]+ )?PRIVATE ' + 'KEY-----')],
  ['Slack token', new RegExp('\\bxox[baprs]-[A-Za-z0-9-]{20,}')],
  ['assigned secret', new RegExp('\\b(?:GEMINI|DEEPGRAM)_API_KEY\\s*[=:]\\s*["\']?(?!["\']|\\$|process|<|your|xxx|changeme)[A-Za-z0-9_-]{20,}')],
];

export function scanSecrets(entries) {
  const out = [];
  for (const { path, text } of entries) {
    text.split('\n').forEach((line, i) => {
      for (const [name, re] of SECRET_PATTERNS) if (re.test(line) && !(name === "assigned secret" && /\.test\./.test(path))) out.push(`${path}:${i + 1}: looks like a ${name}`);
    });
  }
  return out;
}

export const FORBIDDEN_MODEL = 'gemini-2.5' + '-flash';
const CODE_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|html|css|example|kts?)$/;
// Docs may say "never use gemini-2.5-flash"; code and config may not contain it.
export function checkForbiddenModel(entries) {
  const out = [];
  for (const { path, text } of entries) {
    if (!CODE_FILE.test(path)) continue;
    if (path.startsWith('scripts/guardrails') || path === 'scripts/lib/guardrails.mjs') continue;
    text.split('\n').forEach((line, i) => {
      if (line.includes(FORBIDDEN_MODEL)) out.push(`${path}:${i + 1}: uses the banned model id (see docs/RESEARCH.md for the current ids)`);
    });
  }
  return out;
}

export const REQUIRED_SCRIPTS = ['dev', 'build', 'start', 'test', 'typecheck', 'lint-boundary', 'check', 'check-docs', 'e2e', 'doctor', 'guard', 'ship', 'rollback', 'health', 'demo:check', 'prepare'];
const BASHISMS = [
  [/(^|[\s&;|(])(rm|cp|mv|ln|touch|cat|chmod|sed|grep|ls|mkdir)\s/, 'a Unix-only command (use a node script)'],
  [/(^|[\s&;|])export\s/, '"export" (not valid on Windows)'],
  [/^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+\S/, 'an inline VAR=value prefix (fails on Windows cmd; use a node script)'],
  [/\$\(|`|\$\{|\$[A-Za-z_]/, 'shell substitution or $VAR (not portable)'],
  [/'/, "single quotes (cmd.exe does not treat them as quotes; use double quotes)"],
];
export function checkPackageScripts(pkg) {
  const out = [];
  const scripts = pkg.scripts ?? {};
  for (const name of REQUIRED_SCRIPTS) if (!(name in scripts)) out.push(`package.json: required script "${name}" is missing`);
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const [re, what] of BASHISMS) if (re.test(cmd)) out.push(`package.json script "${name}" uses ${what}: ${cmd}`);
  }
  if (scripts.check && !/\bguard/.test(scripts.check)) out.push('package.json: "check" must run the guardrails (guard-repo)');
  if (scripts.prepare && !/install-hooks/.test(scripts.prepare)) out.push('package.json: "prepare" must install the git hooks');
  return out;
}

export const REQUIRED_FILES = [
  'CLAUDE.md', 'server/CLAUDE.md', 'src/hud-kit/CLAUDE.md', 'android-wrapper/CLAUDE.md',
  'docs/TEAMMATE-GUIDE.md', 'docs/GUARDRAILS.md', 'docs/FRD-v2.2.md', '.github/CODEOWNERS', '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/ci.yml', '.github/ruleset-main.json', '.githooks/pre-push', '.githooks/pre-push.mjs', '.gitattributes', '.env.example',
  'scripts/guard-allowlist.json', 'scripts/lib/diffguards.mjs', 'scripts/ship.mjs', 'scripts/rollback.mjs', 'scripts/health.mjs',
];
export function checkRequiredFiles(exists) {
  return REQUIRED_FILES.filter((f) => !exists(f)).map((f) => `${f}: required file is missing`);
}

export const PROTECTED_PATHS = ['server/', 'shared/', 'src/hud-kit/', 'scripts/', '.github/', 'CLAUDE.md', 'docs/FRD-v2.2.md', '.githooks/'];
export function checkCodeowners(text) {
  const out = [];
  const rules = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
  for (const p of PROTECTED_PATHS) {
    const want = p.startsWith('/') ? p : '/' + p;
    const hit = rules.find(([pat, ...owners]) => (pat === want || pat === want.replace(/\/$/, '') || pat === '*' ) && owners.length > 0);
    if (!hit) out.push(`.github/CODEOWNERS: protected path "${p}" has no owner`);
  }
  return out;
}

export const REQUIRED_JOBS = ['ci', 'e2e', 'freeze'];
// CI is an optional extra: harmless if it never runs, never privileged by accident.
export function checkWorkflow(text) {
  const out = [];
  for (const j of REQUIRED_JOBS) if (!new RegExp(`^\\s+name:\\s*${j}\\s*$`, 'm').test(text)) out.push(`ci.yml: job named "${j}" is missing`);
  if ((text.match(/contents:\s*write/g) ?? []).length > 1) out.push('ci.yml: "contents: write" may appear only once (the tag-moving job)');
  if (!/workflow_dispatch/.test(text)) out.push('ci.yml: workflow_dispatch is missing (so it can be run by hand)');
  if (!/persist-credentials:\s*false/.test(text)) out.push('ci.yml: checkout must set persist-credentials: false');
  if (!/timeout-minutes:/.test(text)) out.push('ci.yml: jobs need timeout-minutes');
  for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
    if (!/@[0-9a-f]{40}$/.test(m[1])) out.push(`ci.yml: action ${m[1]} is not pinned to a full commit SHA`);
  }
  if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(text)) out.push('ci.yml: top-level "permissions: contents: read" is missing');
  if (!/cancel-in-progress:\s*true/.test(text)) out.push('ci.yml: concurrency cancel-in-progress is missing');
  if (!/node-version:\s*["']?22/.test(text)) out.push('ci.yml: Node 22 is not pinned');
  if (/pull_request_target/.test(text)) out.push('ci.yml: pull_request_target is not allowed (runs untrusted code with secrets)');
  return out;
}

// The ruleset for main may only block force-push and deletion. Nothing may force PRs, reviews or CI.
export function checkRuleset(json) {
  let r;
  try { r = JSON.parse(json); } catch { return ['.github/ruleset-main.json: not valid JSON']; }
  const out = [];
  const types = (r.rules ?? []).map((x) => x.type);
  for (const t of ['non_fast_forward', 'deletion']) if (!types.includes(t)) out.push(`ruleset-main.json: rule "${t}" is missing`);
  for (const t of types) if (!['non_fast_forward', 'deletion'].includes(t)) out.push(`ruleset-main.json: rule "${t}" is not allowed (teammates push directly; nothing may require PRs, reviews or CI)`);
  if (/last-known-good/.test(json)) out.push('ruleset-main.json: must not protect the last-known-good tag (it has to be movable)');
  return out;
}

export function checkGitattributes(text) {
  return /^\*\s+text=auto\s+eol=lf\s*$/m.test(text) ? [] : ['.gitattributes: must force LF line endings ("* text=auto eol=lf")'];
}

export function checkFrdGuardPresent(exists, read) {
  const f = 'src/apps/bedside-glance/glasses/copyAudit.test.ts';
  if (!exists(f)) return [`${f}: the FRD verbatim-copy test was deleted`];
  const t = read(f);
  return /FRD/.test(t) && /\bit\(|\btest\(/.test(t) ? [] : [`${f}: no longer checks copy against the FRD`];
}

export const POLICY_TEXT = 'docs/GUARDRAILS.md';
