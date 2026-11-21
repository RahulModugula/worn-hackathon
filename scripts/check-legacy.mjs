#!/usr/bin/env node
// Guards /glasses against the Android 9 WebView (Chromium ~69, factory version unknown).
// Pure Node. Exit 1 on any failing finding; warnings never fail.
// Parser: TypeScript's (already a devDependency). acorn is not installed; see docs/COMPAT-PERF.md.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

const failures = [];
const warnings = [];
const info = [];

// ---------- helpers ----------
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
const isTest = (p) => /\.test\.[cm]?[jt]sx?$/.test(p);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ---------- 1. JS syntax at ES2018 (module goal), plus ES2019+ feature gate ----------
// Chromium 69 has: ES2019 syntax, dynamic import(), import.meta, BigInt, class fields (72) NOT, numeric separators (75) NOT.
// Failing: ?. and ?? (Chromium 80), logical assignment (85), numeric separators (75), class fields/private names (72/74), static blocks (94).
const jsFiles = existsSync(join(DIST, 'assets'))
  ? readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => join(DIST, 'assets', f))
  : [];
if (jsFiles.length === 0) failures.push('dist/assets has no .js files: run `npm run build` first');

function scanJs(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2018, true, ts.ScriptKind.JS);
  const parseErrors = sf.parseDiagnostics ?? [];
  for (const d of parseErrors) {
    const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    failures.push(`${rel(file)}:${line + 1} syntax error: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  const visit = (node) => {
    const at = () => `${rel(file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) && node.questionDotToken) {
      failures.push(`${at()} optional chaining "?." (Chromium 80)`);
    }
    if (ts.isBinaryExpression(node)) {
      const k = node.operatorToken.kind;
      if (k === ts.SyntaxKind.QuestionQuestionToken) failures.push(`${at()} nullish coalescing "??" (Chromium 80)`);
      if (k === ts.SyntaxKind.QuestionQuestionEqualsToken || k === ts.SyntaxKind.BarBarEqualsToken || k === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
        failures.push(`${at()} logical assignment (Chromium 85)`);
      }
    }
    if (ts.isNumericLiteral(node) && /_/.test(node.getText(sf))) failures.push(`${at()} numeric separator (Chromium 75)`);
    if (ts.isPrivateIdentifier(node)) failures.push(`${at()} private class member "#name" (Chromium 74)`);
    if (ts.isPropertyDeclaration(node)) failures.push(`${at()} class field (Chromium 72)`);
    if (ts.isClassStaticBlockDeclaration(node)) failures.push(`${at()} class static block (Chromium 94)`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // Script goal: informational. Module bundles with import/export are expected to fail here.
  try {
    new vm.Script(text, { filename: file });
  } catch (err) {
    if (!/import|export/.test(String(err.message))) failures.push(`${rel(file)} script-goal syntax error: ${err.message}`);
    else info.push(`${rel(file)}: module-only syntax (import/export), script goal skipped`);
  }
}
for (const f of jsFiles) scanJs(f);

// ---------- 2. CSS features that fail below Chromium 69 ----------
const CSS_RULES = [
  { name: 'flex gap (Chromium 84)', re: /(?:^|[;{\s])(?:row-|column-)?gap\s*:/, needsFlex: true },
  { name: 'inset shorthand (Chromium 87)', re: /(?:^|[;{\s])inset\s*:/ },
  { name: 'aspect-ratio (Chromium 88)', re: /aspect-ratio\s*:/ },
  { name: ':is() (Chromium 88)', re: /:is\(/ },
  { name: ':where() (Chromium 88)', re: /:where\(/ },
  { name: ':focus-visible (Chromium 86)', re: /:focus-visible/ },
  { name: ':has() (Chromium 105)', re: /:has\(/ },
  { name: 'clamp() (Chromium 79)', re: /\bclamp\(/ },
  { name: 'min() (Chromium 79)', re: /(?:^|[\s:,(])min\(/ },
  { name: 'max() (Chromium 79)', re: /(?:^|[\s:,(])max\(/ },
  { name: 'overflow: clip (Chromium 90)', re: /overflow(?:-x|-y)?\s*:\s*clip\b/ },
  { name: 'dvh/svh/lvh units (Chromium 108)', re: /\d(?:d|s|l)vh\b/ },
];
const FLEX_DISPLAY = /display\s*:\s*(?:inline-)?flex\b/;

// Scan the declaration blocks (innermost, so @media works) of one CSS text.
function cssFindings(raw) {
  // Blank out comments but keep offsets, so line numbers stay true.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  const blockRe = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const decls = m[2];
    const declStart = m.index + m[0].indexOf('{') + 1;
    for (const rule of CSS_RULES) {
      const hit = rule.re.exec(decls);
      if (!hit) continue;
      if (rule.needsFlex && !FLEX_DISPLAY.test(decls)) continue;
      out.push({ index: declStart + hit.index, feature: rule.name, selector: m[1].trim().slice(0, 60) });
    }
  }
  return out;
}

// dist CSS: the entry stylesheet (referenced by dist/index.html) must pass; lazy-chunk CSS is a warning.
const indexHtml = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf8') : '';
const entryCss = new Set([...indexHtml.matchAll(/href="\/?(assets\/[^"]+\.css)"/g)].map((m) => join(DIST, m[1])));
for (const f of walk(join(DIST, 'assets'), (p) => p.endsWith('.css'))) {
  const text = readFileSync(f, 'utf8');
  for (const hit of cssFindings(text)) {
    const msg = `${rel(f)} (minified, offset ${hit.index}) ${hit.feature} in "${hit.selector}"`;
    (entryCss.has(f) ? failures : warnings).push(msg);
  }
}

// Source CSS: hud-kit and glasses must pass; phone and impact run on modern iPhones, so they warn.
const srcCss = [
  ...walk(join(ROOT, 'src/hud-kit'), (p) => p.endsWith('.css')),
  ...walk(join(ROOT, 'src/apps/bedside-glance/glasses'), (p) => p.endsWith('.css')),
  ...walk(join(ROOT, 'src/apps/bedside-glance/phone'), (p) => p.endsWith('.css')),
  ...walk(join(ROOT, 'src/apps/bedside-glance/impact'), (p) => p.endsWith('.css')),
];
for (const f of srcCss) {
  const text = readFileSync(f, 'utf8');
  const exempt = /[\\/](phone|impact)[\\/]/.test(f);
  for (const hit of cssFindings(text)) {
    const msg = `${rel(f)}:${lineOf(text, hit.index)} ${hit.feature} in "${hit.selector}"`;
    (exempt ? warnings : failures).push(msg);
  }
}

// ---------- 3. Runtime APIs used by source reachable from /glasses ----------
// polyfilled: installed by src/polyfills.ts (imported first in main.tsx). Unpolyfilled uses fail.
const RUNTIME_APIS = [
  { name: 'Object.fromEntries (Chromium 73)', re: /Object\.fromEntries\b/, polyfilled: true, polyfillMarker: "'fromEntries'" },
  { name: 'Array.prototype.at (Chromium 92)', re: /\.at\(/, polyfilled: true, polyfillMarker: "'at'" },
  { name: 'Promise.allSettled (Chromium 76)', re: /Promise\.allSettled\b/, polyfilled: true, polyfillMarker: "'allSettled'" },
  { name: 'AbortSignal.timeout (Chromium 103)', re: /AbortSignal\.timeout\b/, polyfilled: true, polyfillMarker: "'timeout'" },
  { name: 'structuredClone (Chromium 98)', re: /\bstructuredClone\b/, polyfilled: true, polyfillMarker: "'structuredClone'" },
  { name: 'queueMicrotask (Chromium 71)', re: /\bqueueMicrotask\b/, polyfilled: true, polyfillMarker: "'queueMicrotask'" },
  // Not polyfilled: a use fails the check until it is removed.
  { name: 'String.prototype.replaceAll (Chromium 85)', re: /\.replaceAll\(/, polyfilled: false },
  { name: 'Object.hasOwn (Chromium 93)', re: /Object\.hasOwn\b/, polyfilled: false },
  { name: 'Array.prototype.findLast (Chromium 97)', re: /\.findLast(?:Index)?\(/, polyfilled: false },
];
const polyfillSrc = existsSync(join(ROOT, 'src/polyfills.ts')) ? readFileSync(join(ROOT, 'src/polyfills.ts'), 'utf8') : '';
for (const api of RUNTIME_APIS) {
  if (api.polyfilled && !polyfillSrc.includes(api.polyfillMarker)) {
    failures.push(`src/polyfills.ts does not install ${api.name}`);
  }
}
const sourceFiles = walk(join(ROOT, 'src'), (p) => /\.[cm]?[jt]sx?$/.test(p) && !isTest(p)).filter(
  (p) => !/[\\/](server|phone|impact)[\\/]/.test(p) && !p.endsWith(`${sep}polyfills.ts`),
);
for (const f of sourceFiles) {
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const api of RUNTIME_APIS) {
      if (!api.re.test(line)) continue;
      const where = `${rel(f)}:${i + 1}`;
      if (api.polyfilled) info.push(`${where} ${api.name} (polyfilled)`);
      else failures.push(`${where} ${api.name} (no polyfill)`);
    }
    // Inline style flex gap (JSX style objects): same Chromium 84 failure as CSS.
    if (/display:\s*'(?:inline-)?flex'/.test(line) && /\bgap:/.test(line)) {
      failures.push(`${rel(f)}:${i + 1} flex gap in inline style (Chromium 84)`);
    }
  });
}

// ---------- report ----------
for (const w of warnings) console.log(`WARN  ${w}`);
for (const i of info) console.log(`INFO  ${i}`);
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(
  `check-legacy: ${jsFiles.length} js bundle(s), ${srcCss.length} source css file(s); ${failures.length} failure(s), ${warnings.length} warning(s), ${info.length} info`,
);
process.exit(failures.length ? 1 : 0);
