#!/usr/bin/env node
// Repo guardrails. `npm run guard-repo` (part of `npm run check`) and the pre-push hook run this.
// Usage: node scripts/guard.mjs [--no-diff] [--base <ref>]
// Local first: nothing here needs GitHub. Plain-English output; exit 1 only when something is actually wrong.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkCodeowners, checkForbiddenModel, checkFrdGuardPresent, checkGitattributes, checkPackageScripts,
  checkRequiredFiles, checkRuleset, checkTrackedFiles, checkWorkflow, scanSecrets,
} from './lib/guardrails.mjs';
import {
  checkAgainstKit, checkBannedInManifest, checkDependencies, checkEnvNames, checkHiddenChars, checkInjection,
  checkNewHosts, checkWeakening, kitFingerprint, parseDiff,
} from './lib/diffguards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (...a) => { try { return git(...a).trim(); } catch { return ''; } };
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|html|css|txt|kts?|xml|properties|webmanifest|example|gitignore|gitattributes|mjs|sh)$|^\.[a-z]+$|CODEOWNERS$/i;

// Only files that can end up in the browser bundle or env template matter for VITE_ names.
const inBundle = (e) => /^(src|shared)\//.test(e.path) || ["index.html", "vite.config.ts", ".env.example"].includes(e.path);

export function resolveBase(env = process.env) {
  // A pushed-over sha (pre-push passes the remote tip) may not exist locally yet: fall through instead of crashing git diff.
  if (env.GUARD_BASE && tryGit('rev-parse', '--verify', '-q', `${env.GUARD_BASE}^{commit}`)) return env.GUARD_BASE;
  for (const ref of ['@{u}', 'origin/main', 'last-known-good']) if (tryGit('rev-parse', '--verify', '-q', ref)) return ref;
  return '';
}

function run() {
  const problems = [];
  const add = (label, list) => { for (const p of list) problems.push(`[${label}] ${p}`); };
  const files = git('ls-files', '-z').split('\0').filter(Boolean).filter((f) => existsSync(path.join(ROOT, f)));
  const sizeOf = (f) => { try { return statSync(path.join(ROOT, f)).size; } catch { return 0; } };
  const readText = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const entries = files.filter((f) => TEXT_EXT.test(f) && f !== 'package-lock.json' && sizeOf(f) < 1_500_000).map((f) => ({ path: f, text: readText(f) }));

  add('files', checkTrackedFiles(files, sizeOf));
  add('secrets', scanSecrets(entries));
  add('secrets', checkEnvNames(entries.filter(inBundle), files));
  add('model', checkForbiddenModel(entries));
  const pkg = JSON.parse(readText('package.json'));
  add('scripts', checkPackageScripts(pkg));
  add('deps', checkBannedInManifest(pkg));
  add('files', checkRequiredFiles((f) => existsSync(path.join(ROOT, f))));
  if (existsSync(path.join(ROOT, '.github/CODEOWNERS'))) add('owners', checkCodeowners(readText('.github/CODEOWNERS')));
  add('ci', checkWorkflow(readText('.github/ci/ci.yml.template'))); // CI is an opt-in template; validate it so it cannot rot
  if (existsSync(path.join(ROOT, '.github/ruleset-main.json'))) add('ruleset', checkRuleset(readText('.github/ruleset-main.json')));
  if (existsSync(path.join(ROOT, '.gitattributes'))) add('lf', checkGitattributes(readText('.gitattributes')));
  add('frd', checkFrdGuardPresent((f) => existsSync(path.join(ROOT, f)), readText));

  let diffNote = 'diff checks skipped (--no-diff)';
  if (!args.includes('--no-diff')) {
    const bi = args.indexOf('--base');
    const base = bi >= 0 ? args[bi + 1] : resolveBase();
    const wanted = process.env.GUARD_BASE;
    if (bi < 0 && wanted && base !== wanted) console.log(`guard: base ${wanted.slice(0, 12)} is not present locally (a teammate pushed first). Run git pull --rebase, then push again. Meanwhile comparing with ${base || 'nothing'}.`);
    if (!base) diffNote = 'diff checks skipped (no upstream, origin/main or last-known-good to compare with)';
    else {
      const parsed = parseDiff(git('diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', base));
      diffNote = `diff checks ran against ${base} (${parsed.length} changed files)`;
      const allow = JSON.parse(readText('scripts/guard-allowlist.json'));
      const msg = `${process.env.BG_COMMIT_MSG ?? ''}\n${tryGit('log', '-1', '--format=%B')}`;
      const approved = process.env.DEPS_APPROVED === '1' || /deps-approved/i.test(msg);
      add('tests', checkWeakening(parsed));
      add('hidden-chars', checkHiddenChars(parsed));
      add('deps', checkDependencies(parsed, { approved }));
      add('hosts', checkNewHosts(parsed, allow.hosts));
      add('injection', checkInjection(parsed, allow.injection));
      const addedEntries = parsed.filter((f) => !f.deleted).map((f) => ({ path: f.path, text: f.added.join('\n') }));
      add('secrets', scanSecrets(addedEntries));
      add('secrets', checkEnvNames(addedEntries.filter(inBundle)));
      const kit = path.join(ROOT, 'kit');
      if (existsSync(kit)) {
        const kitFiles = [];
        const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (s.size < 50_000_000 && kitFiles.length < 20000) kitFiles.push({ rel: path.relative(kit, p).split(path.sep).join('/'), bytes: readFileSync(p) }); } };
        try { walk(kit); } catch { /* unreadable kit: skip */ }
        const fp = kitFingerprint(kitFiles);
        add('kit', checkAgainstKit(fp, parsed, (f) => { try { return readFileSync(path.join(ROOT, f)); } catch { return null; } }));
        diffNote += `; kit check compared with ${kitFiles.length} local kit files`;
      } else diffNote += '; no local kit/ so the kit-confidentiality check did not run on this machine';
    }
  }
  return { problems, diffNote, count: files.length };
}

if (/[\\/]guard\.mjs$/.test(process.argv[1] ?? '')) {
  const { problems, diffNote, count } = run();
  if (problems.length) {
    console.error(`GUARD FAILED: ${problems.length} problem(s) in ${count} tracked files (${diffNote}).\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nFix each line above, then run it again. If a line does not make sense, ask your AI assistant to "fix the guard failure without weakening the guard" or ask the lead. Never bypass it with --no-verify.');
    process.exit(1);
  }
  console.log(`guard OK: ${count} tracked files, ${diffNote}`);
}
