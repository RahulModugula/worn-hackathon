#!/usr/bin/env node
// Guard: docs must not point at files or npm scripts that do not exist.
// Run by `npm run check`. Cross-platform (pure Node).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Files that are promised by tickets but created later by teammates. Remove from this list when created.
const PLANNED = new Set(['docs/demo-script.md']);
const ROOTS = ['src/', 'server/', 'shared/', 'data/', 'public/', 'scripts/', 'docs/', 'android-wrapper/', 'kit/'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'build', 'kit'].includes(name)) continue;
    const p = path.join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.md') && !p.includes(`${path.sep}prebuilt${path.sep}`)) out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts || {}));
const files = ['CLAUDE.md', 'README.md', ...walk('docs'), ...walk('src'), ...walk('server'), ...walk('android-wrapper'), ...walk('scripts')]
  .filter((f) => existsSync(f));

const problems = [];
for (const file of new Set(files)) {
  const text = readFileSync(file, 'utf8');
  // npm run <script>
  for (const m of text.matchAll(/npm run ([a-z0-9:_-]+)/gi)) {
    if (!scripts.has(m[1])) problems.push(`${file}: npm script "${m[1]}" is not in package.json`);
  }
  // `path/like/this.ext` in backticks
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    let t = m[1].replace(/[.,:;)]+$/, '');
    if (!ROOTS.some((r) => t.startsWith(r))) continue;
    if (/[<>*{}$|]|\.\.\.|\(/.test(t)) continue;
    if (t.startsWith('kit/')) continue; // confidential kit lives outside git
    t = t.replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
    if (!/\.[a-z0-9]+$/i.test(t) && !t.endsWith('/')) continue;
    if (PLANNED.has(t)) continue;
    if (!existsSync(t)) problems.push(`${file}: references "${t}" which does not exist`);
  }
}

if (problems.length) {
  console.error(`docs check FAILED (${problems.length}):\n- ${[...new Set(problems)].join('\n- ')}`);
  process.exit(1);
}
console.log(`docs check OK (${new Set(files).size} files)`);
