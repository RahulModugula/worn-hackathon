// AC#10 module boundary: src/hud-kit/ must not import from src/apps/ and must not
// contain Bedside Glance words. Exits 1 with file:line for each violation.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const hudDir = join(root, 'src', 'hud-kit');

// Whole-word match so "medium" and "media" do not trip the "med" rule.
const FORBIDDEN_WORDS = /\b(bedside|glance|patient|med|wound)\b/i;
const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (!name.endsWith('.md')) out.push(p); // docs (e.g. CLAUDE.md) describe the rule and list the banned words
  }
  return out;
}

if (!existsSync(hudDir)) {
  console.error(`lint-boundary: missing ${relative(root, hudDir)}`);
  process.exit(1);
}

const violations = [];
const files = walk(hudDir);

for (const file of files) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = FORBIDDEN_WORDS.exec(line);
    if (m) violations.push(`${rel}:${i + 1}: forbidden word "${m[0]}"`);
  });
  if (CODE_EXT.test(file)) {
    const src = lines.join('\n');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[2];
      const segments = spec.split('/');
      const resolvedInApps = spec.startsWith('.') && resolve(file, '..', spec).startsWith(join(root, 'src', 'apps'));
      if (segments.includes('apps') || resolvedInApps) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push(`${rel}:${line}: forbidden import "${spec}" (hud-kit must not import apps/)`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  console.error(`lint-boundary FAILED: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log(`lint-boundary OK: ${files.length} files scanned in src/hud-kit`);
