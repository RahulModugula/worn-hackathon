// Zero-PII audit for the Bedside Glance demo data (FRD v2.2 section 5 / BG-03).
// Scans data/**, public/data/** and src/** for SSNs, street addresses, 9+ digit
// numbers, email addresses and the MRN label. Prints file:line and the rule name
// only, never the matched text. Exit 0 = clean, 1 = findings, 2 = error.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['data', 'public/data', 'src'];

const RULES = [
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    name: 'street-address',
    re: /\b\d{1,6}\s+(?:[A-Za-z][A-Za-z.]*\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Hwy|Terrace)\b/,
  },
  { name: 'nine-plus-digits', re: /(?<!\d)\d{9,}(?!\d)/ },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'mrn-label', re: /\bMRN\b/ },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let findings = 0;
let scanned = 0;
let skippedBinary = 0;

for (const rel of SCAN_DIRS) {
  const dir = join(root, rel);
  let files;
  try {
    files = [...walk(dir)];
  } catch (err) {
    if (err.code === 'ENOENT') continue;
    console.error(`audit-pii: cannot read ${rel}: ${err.message}`);
    process.exit(2);
  }
  for (const file of files) {
    const buf = readFileSync(file);
    if (buf.includes(0)) {
      skippedBinary++;
      continue;
    }
    scanned++;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((rawLine, i) => {
      // Citation URLs legitimately contain long digit runs (article ids); judge the rest of the line.
      const line = rawLine
        .replace(/https?:\/\/[^\s'"`)]+/g, ' ')
        .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s'"`)]*/gi, ' ');
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings++;
          console.log(`FAIL ${rule.name} ${relative(root, file)}:${i + 1}`);
        }
      }
    });
  }
}

console.log(`audit-pii: scanned ${scanned} text files, skipped ${skippedBinary} binary, ${findings} finding(s)`);
process.exit(findings === 0 ? 0 : 1);
