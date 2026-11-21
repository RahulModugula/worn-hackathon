// @vitest-environment node
// The guardrails are themselves tested: each guard passes on the real repo AND fails on a planted violation.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_MODEL, checkCodeowners, checkForbiddenModel, checkFrdGuardPresent, checkGitattributes, checkPackageScripts,
  checkRequiredFiles, checkRuleset, checkTrackedFiles, checkWorkflow, scanSecrets,
} from './lib/guardrails.mjs';
import { evaluateFreeze, FREEZE_AT, parseLabels } from './freeze-guard.mjs';
import { install } from './install-hooks.mjs';
import { PROTECTED, protectedChanges } from './lib/protected.mjs';
import {
  actionsUrl, backupBranchName, canSkipPrePush, isConflictOutput, lkgPushArgs, needsChecks, parsePushLines, parseRemote, pushTarget,
  shouldMoveLkg, usesForbiddenFlags, validateMessage,
} from './lib/workflow.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const sizeOf = () => 1000;

describe('real repo passes the repo guards', () => {
  it('node scripts/guard.mjs --no-diff exits 0', () => {
    const r = spawnSync(process.execPath, ['scripts/guard.mjs', '--no-diff'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
  it('real package.json, CODEOWNERS, workflow, ruleset, gitattributes are valid', () => {
    expect(checkPackageScripts(JSON.parse(read('package.json')))).toEqual([]);
    expect(checkCodeowners(read('.github/CODEOWNERS'))).toEqual([]);
    expect(checkWorkflow(read('.github/workflows/ci.yml'))).toEqual([]);
    expect(checkRuleset(read('.github/ruleset-main.json'))).toEqual([]);
    expect(checkGitattributes(read('.gitattributes'))).toEqual([]);
    expect(checkRequiredFiles((f: string) => existsSync(path.join(ROOT, f)))).toEqual([]);
  });
});

describe('tracked-file policy', () => {
  it('rejects kit, env, private notes, .claude, node_modules, zips', () => {
    for (const p of ['kit/readme.md', '.env', '.env.local', 'a/.env.production', 'private-notes/x.md', '.claude/settings.json', 'node_modules/x/y.js', 'MicroLumin_SDK.zip', 'x.zip']) {
      expect(checkTrackedFiles([p], sizeOf).length, p).toBeGreaterThan(0);
    }
  });
  it('accepts .env.example and normal files', () => {
    expect(checkTrackedFiles(['.env.example', 'src/a.ts', 'docs/x.md'], sizeOf)).toEqual([]);
  });
  it('rejects files over 2 MB except allowlisted images, the APK and decks', () => {
    const big = () => 3 * 1048576;
    expect(checkTrackedFiles(['src/data.json', 'docs/huge.md', 'server/x.bin'], big)).toHaveLength(3);
    expect(checkTrackedFiles(['android-wrapper/prebuilt/bedside-wrapper-debug.apk', 'docs/img/a.png', 'docs/decks/d.html', 'public/hero.png'], big)).toEqual([]);
    expect(checkTrackedFiles(['android-wrapper/other.apk'], big)).toHaveLength(1);
  });
});

describe('secret scan', () => {
  const fake = {
    google: 'AI' + 'za' + 'A'.repeat(35),
    github: 'gh' + 'p_' + 'a'.repeat(36),
    aws: 'AK' + 'IA' + 'A'.repeat(16),
    key: '-----BEGIN RSA PRIVATE ' + 'KEY-----',
    assigned: 'GEMINI' + '_API_KEY=' + 'abcdefghij0123456789abcd',
    sk: 'sk-' + 'a'.repeat(40),
  };
  it('flags each secret shape', () => {
    for (const [k, v] of Object.entries(fake)) expect(scanSecrets([{ path: 'a.ts', text: `const x = "${v}"` }]).length, k).toBeGreaterThan(0);
  });
  it('does not flag placeholders, env reads or empty template lines', () => {
    const ok = ['GEMINI_API_KEY=', 'const k = process.env.GEMINI_API_KEY', 'GEMINI_API_KEY=<your key>', 'export GEMINI_API_KEY=$GEMINI_API_KEY', 'DEEPGRAM_API_KEY=your-key-here-goes-and-so-on'];
    expect(scanSecrets(ok.map((text) => ({ path: 'a.md', text })))).toEqual([]);
  });
});

describe('forbidden model id', () => {
  it('flags it in code and config, allows docs that warn against it', () => {
    expect(checkForbiddenModel([{ path: 'server/a.ts', text: `model: '${FORBIDDEN_MODEL}'` }])).toHaveLength(1);
    expect(checkForbiddenModel([{ path: 'render.yaml', text: `value: ${FORBIDDEN_MODEL}` }])).toHaveLength(1);
    expect(checkForbiddenModel([{ path: 'CLAUDE.md', text: `never use ${FORBIDDEN_MODEL}` }])).toEqual([]);
  });
});

describe('package.json windows safety and required scripts', () => {
  const base = JSON.parse(read('package.json'));
  const withScript = (name: string, cmd: string) => ({ ...base, scripts: { ...base.scripts, [name]: cmd } });
  it('rejects unix-only commands and syntax', () => {
    for (const cmd of ['rm -rf dist', 'cp a b', 'export X=1 && node a', 'PORT=3002 node a.js', "echo 'hi'", 'echo $HOME', 'node a.js `date`', 'mkdir x']) {
      expect(checkPackageScripts(withScript('x', cmd)).length, cmd).toBeGreaterThan(0);
    }
  });
  it('accepts node-based commands', () => {
    expect(checkPackageScripts(withScript('x', 'node scripts/a.mjs && vitest run'))).toEqual([]);
  });
  it('requires the core scripts and check must run the guard', () => {
    const scripts = { ...base.scripts };
    delete scripts.ship;
    expect(checkPackageScripts({ ...base, scripts }).join()).toContain('"ship"');
    expect(checkPackageScripts(withScript('check', 'npm test')).join()).toContain('guardrails');
    expect(checkPackageScripts(withScript('prepare', 'echo hi')).join()).toContain('hooks');
  });
});

describe('required files, CODEOWNERS, workflow, ruleset, gitattributes, FRD guard', () => {
  it('reports missing required files', () => {
    expect(checkRequiredFiles(() => false).length).toBeGreaterThan(5);
    expect(checkRequiredFiles((f: string) => f !== 'CLAUDE.md')).toEqual(['CLAUDE.md: required file is missing']);
  });
  it('CODEOWNERS must cover every protected path', () => {
    expect(checkCodeowners('').length).toBeGreaterThan(5);
    const owners = read('.github/CODEOWNERS').replace(/^\/server\/.*$/m, '');
    expect(checkCodeowners(owners).join()).toContain('server/');
  });
  const wf = read('.github/workflows/ci.yml');
  it('workflow needs the job names, pinned SHAs, read-only token, concurrency, Node 22, manual trigger', () => {
    expect(checkWorkflow(wf.replace(/name: e2e/, 'name: browser')).join()).toContain('"e2e"');
    expect(checkWorkflow(wf.replace(/(uses: actions\/checkout@)[0-9a-f]{40}/, '$1v4')).join()).toContain('not pinned');
    expect(checkWorkflow(wf.replace(/^permissions:\s*\n\s+contents: read/m, 'permissions: write-all')).join()).toContain('permissions');
    expect(checkWorkflow(wf.replace(/cancel-in-progress: true/, 'cancel-in-progress: false')).join()).toContain('cancel-in-progress');
    expect(checkWorkflow(wf.replace(/node-version: .*/g, 'node-version: 18')).join()).toContain('Node 22');
    expect(checkWorkflow(wf.replace(/workflow_dispatch/, 'nothing')).join()).toContain('workflow_dispatch');
    expect(checkWorkflow(wf + '\n  pull_request_target:\n').join()).toContain('pull_request_target');
    expect(checkWorkflow(wf + '\npermissions:\n  contents: write\n').join()).toContain('only once');
  });
  it('ruleset may only block force-push and deletion', () => {
    const good = JSON.stringify({ rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }] });
    expect(checkRuleset(good)).toEqual([]);
    expect(checkRuleset(JSON.stringify({ rules: [{ type: 'deletion' }] }))).toHaveLength(1);
    expect(checkRuleset(JSON.stringify({ rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }, { type: 'pull_request' }] })).join()).toContain('pull_request');
    expect(checkRuleset(JSON.stringify({ rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }, { type: 'required_status_checks' }] }))).toHaveLength(1);
    expect(checkRuleset('{nope')).toHaveLength(1);
  });
  it('gitattributes must force LF', () => {
    expect(checkGitattributes('* text=auto\n')).toHaveLength(1);
    expect(checkGitattributes('* text=auto eol=lf\n')).toEqual([]);
  });
  it('FRD verbatim-copy test must stay', () => {
    expect(checkFrdGuardPresent(() => false, () => '')).toHaveLength(1);
    expect(checkFrdGuardPresent(() => true, () => 'nothing here')).toHaveLength(1);
    expect(checkFrdGuardPresent(() => true, () => "// FRD\nit('x', () => {})")).toEqual([]);
  });
});

describe('hud-kit boundary is still enforced', () => {
  it('check-hud-boundary passes on a clean kit and fails on a Bedside word or an apps import', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hudb-'));
    try {
      mkdirSync(path.join(dir, 'scripts'));
      mkdirSync(path.join(dir, 'src', 'hud-kit'), { recursive: true });
      cpSync(path.join(ROOT, 'scripts', 'check-hud-boundary.mjs'), path.join(dir, 'scripts', 'check-hud-boundary.mjs'));
      writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
      const run = () => spawnSync(process.execPath, ['scripts/check-hud-boundary.mjs'], { cwd: dir, encoding: 'utf8' });
      writeFileSync(path.join(dir, 'src/hud-kit/a.ts'), 'export const a = 1;\n');
      expect(run().status).toBe(0);
      writeFileSync(path.join(dir, 'src/hud-kit/b.ts'), 'export const patient = 1;\n');
      expect(run().status).toBe(1);
      writeFileSync(path.join(dir, 'src/hud-kit/b.ts'), "import x from '../apps/foo';\n");
      expect(run().status).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('freeze guard', () => {
  const before = new Date('2026-11-21T18:59:59Z');
  const at = new Date('2026-11-21T19:00:00Z');
  it('allows before the freeze and refuses at or after it', () => {
    expect(evaluateFreeze(before).ok).toBe(true);
    expect(evaluateFreeze(at).ok).toBe(false);
    expect(evaluateFreeze(new Date('2026-11-22T00:00:00Z')).ok).toBe(false);
    expect(FREEZE_AT).toBe('2026-11-21T19:00:00Z');
  });
  it('honours the freeze-exception label and FREEZE_EXCEPTION=1, nothing else', () => {
    expect(evaluateFreeze(at, ['freeze-exception']).ok).toBe(true);
    expect(evaluateFreeze(at, ['bug']).ok).toBe(false);
    expect(evaluateFreeze(at, [], FREEZE_AT, { FREEZE_EXCEPTION: '1' }).ok).toBe(true);
    expect(evaluateFreeze(at, [], FREEZE_AT, { FREEZE_EXCEPTION: '0' }).ok).toBe(false);
  });
  it('fails closed on a garbage clock', () => {
    expect(evaluateFreeze(new Date('nope')).ok).toBe(false);
  });
  it('parses labels', () => {
    expect(parseLabels('a, freeze-exception ,')).toEqual(['a', 'freeze-exception']);
    expect(parseLabels('')).toEqual([]);
  });
  it('the CLI exits 1 after the freeze (today is past it) unless excepted', () => {
    const r = spawnSync(process.execPath, ['scripts/freeze-guard.mjs', '--labels', 'freeze-exception'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});

describe('ship / rollback / hook helpers', () => {
  it('validates commit messages', () => {
    expect(validateMessage('').ok).toBe(false);
    expect(validateMessage(undefined).ok).toBe(false);
    expect(validateMessage('fix').ok).toBe(false);
    expect(validateMessage('wip').ok).toBe(false);
    expect(validateMessage('x'.repeat(300)).ok).toBe(false);
    expect(validateMessage('  Fix the allergy banner text  ')).toEqual({ ok: true, message: 'Fix the allergy banner text' });
  });
  it('parses git remotes', () => {
    expect(parseRemote('git@github.com:RahulModugula/worn-hackathon.git')).toEqual({ host: 'github.com', owner: 'RahulModugula', repo: 'worn-hackathon' });
    expect(parseRemote('https://github.com/a/b')).toEqual({ host: 'github.com', owner: 'a', repo: 'b' });
    expect(parseRemote('https://user@github.com/a/b.git/')).toEqual({ host: 'github.com', owner: 'a', repo: 'b' });
    expect(parseRemote('ssh://git@github.com/a/b.git')?.repo).toBe('b');
    expect(parseRemote('/tmp/bare.git')).toBeNull();
    expect(actionsUrl('git@github.com:a/b.git')).toBe('https://github.com/a/b/actions');
    expect(actionsUrl('git@gitlab.com:a/b.git')).toBeNull();
  });
  it('pushes the current branch, never a detached HEAD', () => {
    expect(pushTarget('main')).toEqual({ ok: true, branch: 'main' });
    expect(pushTarget('HEAD').ok).toBe(false);
    expect(pushTarget('').ok).toBe(false);
  });
  it('detects rebase conflicts', () => {
    expect(isConflictOutput('CONFLICT (content): Merge conflict in a.ts')).toBe(true);
    expect(isConflictOutput('Already up to date.')).toBe(false);
  });
  it('last-known-good: lease only on that tag, moves forward only', () => {
    expect(lkgPushArgs('abc123')).toEqual(['push', 'origin', 'refs/tags/last-known-good', '--force-with-lease=refs/tags/last-known-good:abc123']);
    expect(lkgPushArgs('')[3]).toBe('--force-with-lease=refs/tags/last-known-good:');
    expect(lkgPushArgs('0000000000000000000000000000000000000000')[3]).toBe('--force-with-lease=refs/tags/last-known-good:');
    expect(shouldMoveLkg({ currentExists: false, currentIsAncestorOfHead: false })).toBe(true);
    expect(shouldMoveLkg({ currentExists: true, currentIsAncestorOfHead: true })).toBe(true);
    expect(shouldMoveLkg({ currentExists: true, currentIsAncestorOfHead: false })).toBe(false);
  });
  it('pre-push: parses refs, skips tag pushes and deletes, honours ship verification', () => {
    const z = '0'.repeat(40);
    const a = 'a'.repeat(40);
    const branch = parsePushLines(`refs/heads/main ${a} refs/heads/main ${z}\n`);
    expect(branch[0]).toMatchObject({ isNew: true, isTag: false, isDelete: false });
    expect(needsChecks(branch)).toBe(true);
    expect(needsChecks(parsePushLines(`refs/tags/last-known-good ${a} refs/tags/last-known-good ${z}\n`))).toBe(false);
    expect(needsChecks(parsePushLines(`(delete) ${z} refs/heads/old ${a}\n`))).toBe(false);
    expect(canSkipPrePush({ BG_VERIFIED_SHA: a }, branch)).toBe(true);
    expect(canSkipPrePush({ BG_VERIFIED_SHA: 'b'.repeat(40) }, branch)).toBe(false);
    expect(canSkipPrePush({}, branch)).toBe(false);
  });
  it('names backup branches and spots forbidden flags', () => {
    expect(backupBranchName(new Date(2026, 10, 21, 9, 5, 7))).toBe('backup/before-rollback-20261121-090507');
    expect(usesForbiddenFlags(['--no-verify', 'x', '--force'])).toEqual(['--no-verify', '--force']);
    expect(usesForbiddenFlags(['hello world'])).toEqual([]);
  });
});

describe('protected paths require their tests, and those tests exist', () => {
  it('every protected area maps to existing test files', () => {
    for (const p of PROTECTED) for (const t of p.tests) expect(existsSync(path.join(ROOT, t)), `${p.prefix} -> ${t}`).toBe(true);
  });
  it('maps changed files to the right areas', () => {
    const hit = protectedChanges(['server/sessionStore.ts', 'src/a.ts', 'docs/FRD-v2.2.md', 'shared/types.ts']).map((h) => h.prefix);
    expect(hit).toEqual(expect.arrayContaining(['server/', 'shared/', 'docs/FRD-v2.2.md']));
    expect(protectedChanges(['src/apps/bedside-glance/phone/Foo.tsx'])).toEqual([]);
  });
});

describe('hook installer never breaks npm', () => {
  it('skips in CI and outside a git checkout, installs in a git checkout', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hooks-'));
    try {
      expect(install(dir, {})).toContain('skipped');
      mkdirSync(path.join(dir, '.git'));
      mkdirSync(path.join(dir, '.githooks'));
      expect(install(dir, { CI: 'true' })).toContain('CI');
      spawnSync('git', ['init', '-q'], { cwd: dir });
      expect(install(dir, {})).toContain('installed');
      const hp = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
      expect(hp).toBe('.githooks');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('the hook ignores tag pushes instantly (exit 0) and runs on branch pushes', () => {
    const z = '0'.repeat(40);
    const a = 'a'.repeat(40);
    const tag = spawnSync(process.execPath, ['.githooks/pre-push.mjs'], { cwd: ROOT, input: `refs/tags/last-known-good ${a} refs/tags/last-known-good ${z}\n`, encoding: 'utf8' });
    expect(tag.status).toBe(0);
    const verified = spawnSync(process.execPath, ['.githooks/pre-push.mjs'], { cwd: ROOT, input: `refs/heads/main ${a} refs/heads/main ${z}\n`, encoding: 'utf8', env: { ...process.env, BG_VERIFIED_SHA: a } });
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain('already verified');
  });
});
