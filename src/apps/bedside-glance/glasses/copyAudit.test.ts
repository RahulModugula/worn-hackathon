// Copy audit: every template, at worst-case inputs, measured with the REAL Nunito font file (fontkit reads the
// variable font at the weight each role uses, with kerning and tabular numerals as the browser applies them).
// Nothing here trusts metrics.ts: that table is itself checked against the font. Each card line (leading icon +
// text + aside) must fit 528px; the status strip (left + gap + right items) must fit 560px; every character must be
// in the font's cmap (icons are drawn as SVG, never as text glyphs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import patientsData from '../../../../data/patients.json';
import { CARD_INNER_WIDTH } from '../../../hud-kit/layout';
import { ADVANCE, measure } from './metrics';
import {
  ASIDE_STYLE, CARD_INNER_HEIGHT, ROLE_STYLE, ROW_GAP_PX, SAFETY_PX, STRIP_GAP_PX, STRIP_LEFT_STYLE, STRIP_RIGHT_STYLE, STRIP_W,
  ICON_GAP_PX, ICON_PX, ASIDE_ICON_GAP_PX, ASIDE_MARGIN_PX, ASIDE_MAX_PX, ITEM_GAP_PX, STRIP_ICON_GAP_PX,
  screenCopy, type Role, type ScreenCopy,
} from './copy';
import {
  SCREEN_IDS, initialState, type GState, type Patient, type ScreenId,
} from './stateMachine';

const ROOT = resolve(__dirname, '../../../..');
const loaded = fontkit.create(readFileSync(resolve(ROOT, 'public/fonts/Nunito-Variable.woff2')));
if (!('unitsPerEm' in loaded)) throw new Error('font collection');
const FONT = loaded as fontkit.Font;
const VARIANT = { 600: FONT.getVariation({ wght: 600 }), 700: FONT.getVariation({ wght: 700 }) };

/** Characters the font lacks: they would render from a fallback face with unknown width. */
const MISSING = new Set<string>();

/** Real rendered width in px: GPOS kerning and tabular numerals on, like the canvas (font-variant-numeric: tabular-nums). */
const CACHE = new Map<string, number>();
function real(text: string, size: number, weight: 600 | 700): number {
  const k = weight + '|' + text;
  let em = CACHE.get(k);
  if (em === undefined) {
    for (const ch of Array.from(text)) if (!FONT.hasGlyphForCodePoint(ch.codePointAt(0)!)) MISSING.add(ch);
    em = VARIANT[weight].layout(text, ['kern', 'tnum']).advanceWidth / FONT.unitsPerEm;
    CACHE.set(k, em);
  }
  return em * size;
}

const css = (name: string) => readFileSync(resolve(ROOT, 'src/hud-kit', name), 'utf8');
const tokens = css('tokens.css');
const token = (n: string) => new RegExp(`${n}:\\s*([^;]+);`).exec(tokens)![1].trim();

function rowWidth(r: ScreenCopy['rows'][number]): number {
  const st = ROLE_STYLE[r.role];
  let w = real(r.text, st.size, st.weight);
  if (r.icon) w += (r.iconPx ?? ICON_PX) + ICON_GAP_PX;
  if (r.aside) w += ASIDE_MARGIN_PX + (r.aside.icon ? ICON_PX + ASIDE_ICON_GAP_PX : 0) + real(r.aside.text, ASIDE_STYLE.size, ASIDE_STYLE.weight);
  return w;
}

function stripWidth(c: ScreenCopy): { left: number; right: number } {
  const left = real(c.left, STRIP_LEFT_STYLE.size, STRIP_LEFT_STYLE.weight);
  const right =
    c.items.reduce((n, it) => n + (it.icon ? ICON_PX + STRIP_ICON_GAP_PX : 0) + real(it.text, STRIP_RIGHT_STYLE.size, STRIP_RIGHT_STYLE.weight), 0) +
    ITEM_GAP_PX * Math.max(0, c.items.length - 1);
  return { left, right };
}

const data = (patientsData as unknown as { patients: Patient[] }).patients;
const worst: Patient = {
  ...data[0],
  id: 'P-WORST', qrPayload: 'BG-P-WORST', name: 'Bartholomew Featherstonehaugh-Montgomery', room: '1214',
  attending: 'Dr. Featherstonehaugh', allergies: ['Penicillin', 'Sulfonamide', 'Latex', 'Shellfish'], diabetic: true,
  glucose: { valueMgDl: 999, takenAt: '11:59' },
  meds: [
    { id: 'W-1', name: 'Hydroxychloroquine', dose: '1000 mg/10 mL', route: 'PO', dueAt: '12:59' },
    { id: 'W-2', name: 'Trimethoprim-sulfamethoxazole', dose: '800 mg', route: 'PO', dueAt: '23:59' },
  ],
  prn: [{ id: 'PRN-W', name: 'Hydromorphone-extended', dose: '12.5 mg', lastGivenAt: '10:59', intervalHours: 4 }],
  wound: { site: 'left lower leg posterior surgical incision site, extensive', lastChangedAt: '09:59', intervalHours: 12, note: 'x' },
  vitals: { bp: '190/110', hr: 188, tempF: 104.9, spo2: 100, takenAt: '12:59', nextAt: '12:59' },
};
/** Widest-letter allergy name, to stress the aside budget. */
const wide: Patient = { ...data[0], id: 'P-WIDE', qrPayload: 'BG-P-WIDE', name: 'Wim Wiwmmmmm', allergies: ['Mmmmmmmmmmmmmmmmmmmm'] };
const none: Patient = { ...data[0], id: 'P-NONE', qrPayload: 'BG-P-NONE', allergies: [] };
const LONG = 'Incision edges closed with no redness. No drainage seen anywhere on the dressing today.';

type Case = ScreenCopy & { id: string };

function allCopy(): Case[] {
  const out: Case[] = [];
  const baseMins = [822, 779, 1439, 600, 0]; // includes 12:59p and 11:59p for the widest clock labels
  for (const patients of [[worst], [wide], [none], data]) {
    for (const p of patients) {
      for (const baseMin of baseMins) {
        for (const offset of [0, 30, 600]) {
          for (const offline of [false, true]) {
            for (const listening of [false, true]) {
              for (const toast of [null, 'Try "done", "vitals", or "close"', 'Already given 12:59 PM via glasses', 'Heard: send to phone']) {
                for (const screen of SCREEN_IDS as readonly ScreenId[]) {
                  const s: GState = {
                    ...initialState(patients),
                    screen, patientId: p.id, offline,
                    session: { medStatus: {}, clock: { baseMin, startedAtMs: 0 }, clockOffsetMin: offset, hasLastLog: false },
                    logged: { name: `${p.meds[0].name} ${p.meds[0].dose}`, at: '12:59 PM' },
                    assessment: { finding: LONG, comparison: LONG, draftNote: LONG, source: listening ? 'gemini' : 'fallback' },
                    notice: { label: p.attending, text: 'Looks good. Continue dressing plan. Call if redness spreads over time.' },
                    toast: toast ? { text: toast, untilMs: 1 } : null,
                    listening, micOff: !listening,
                    fadeAtMs: 3000,
                    alert: { allergy: 'Sulfonamide', drug: 'Trimethoprim-sulfamethoxazole 800 mg' },
                  };
                  for (const stage of ['upload', 'assess', 'failed'] as const) {
                    for (const scanFail of screen === 'G3' ? (['unknown', 'unassigned'] as const) : ([null] as const)) {
                      const c = screenCopy({ ...s, stage, scanFail }, 0);
                      out.push({ id: `${p.id}/${screen}/${stage}/${scanFail}/${baseMin}+${offset}/${offline}/${listening}/${toast ?? '-'}`, ...c });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  // Idle (no patient), with and without the mic, for the brand word.
  for (const baseMin of baseMins) {
    for (const listening of [false, true]) {
      for (const offline of [false, true]) {
        const idle = screenCopy({ ...initialState(data), listening, offline, session: { medStatus: {}, clock: { baseMin, startedAtMs: 0 }, clockOffsetMin: 0, hasLastLog: false } }, 0);
        out.push({ id: `idle/${baseMin}/${listening}/${offline}`, ...idle });
      }
    }
  }
  return out;
}

describe('the font file and the metrics table', () => {
  it('is a variable rounded face with a weight axis covering 600 and 700', () => {
    const axis = (FONT as unknown as { variationAxes: Record<string, { min: number; max: number }> }).variationAxes.wght;
    expect(axis.min).toBeLessThanOrEqual(600);
    expect(axis.max).toBeGreaterThanOrEqual(700);
  });
  it('metrics.ts advances match the real font at 600 and 700 (within 1/1000 em)', () => {
    for (const w of [600, 700] as const) {
      for (const [ch, adv] of ADVANCE[w]) {
        const real1000 = VARIANT[w].glyphForCodePoint(ch.codePointAt(0)!).advanceWidth * (1000 / FONT.unitsPerEm);
        expect(Math.abs(real1000 - adv), `${ch} @${w}`).toBeLessThanOrEqual(1);
      }
    }
  });
  it('is proportional (digits are tabular, letters are not)', () => {
    const adv = (c: string) => VARIANT[600].glyphForCodePoint(c.codePointAt(0)!).advanceWidth;
    expect(adv('i')).toBeLessThan(adv('m'));
    expect(adv('0')).toBe(adv('8'));
    expect(measure('iiii', 20, 600)).toBeLessThan(measure('mmmm', 20, 600));
  });
});

describe('type scale and tokens', () => {
  it('role sizes are at least 18px and tokens.css mirrors copy.ts (size, line height, weight)', () => {
    const size: Record<Role, string> = { label: '--hud-size-label', hero: '--hud-size-hero', body: '--hud-size-body', hint: '--hud-size-hint', meta: '--hud-size-meta' };
    const lh: Record<Role, string> = { label: '--hud-lh-label', hero: '--hud-lh-hero', body: '--hud-lh-body', hint: '--hud-lh-hint', meta: '--hud-lh-meta' };
    const weight: Record<Role, string> = { label: '--hud-weight-label', hero: '--hud-weight-hero', body: '--hud-weight-body', hint: '--hud-weight-hint', meta: '--hud-weight-hint' };
    for (const r of Object.keys(ROLE_STYLE) as Role[]) {
      expect(ROLE_STYLE[r].size).toBeGreaterThanOrEqual(18);
      expect(parseFloat(token(size[r]))).toBe(ROLE_STYLE[r].size);
      expect(parseFloat(token(lh[r]))).toBe(ROLE_STYLE[r].lineHeight);
      expect(Number(token(weight[r]))).toBe(ROLE_STYLE[r].weight);
    }
    expect(ASIDE_STYLE.size).toBeGreaterThanOrEqual(18);
    expect(STRIP_RIGHT_STYLE.size).toBeGreaterThanOrEqual(18);
    expect(STRIP_LEFT_STYLE.size).toBeGreaterThanOrEqual(18);
  });
  it('hero is about 1.6-2x body; luminance ladder is 100 / 75 / 60 and nothing is under 40%', () => {
    const ratio = ROLE_STYLE.hero.size / ROLE_STYLE.body.size;
    expect(ratio).toBeGreaterThanOrEqual(1.6);
    expect(ratio).toBeLessThanOrEqual(2);
    expect(Number(token('--hud-opacity-hero'))).toBe(1);
    expect(Number(token('--hud-opacity-body'))).toBeGreaterThanOrEqual(0.7);
    expect(Number(token('--hud-opacity-body'))).toBeLessThanOrEqual(0.75);
    expect(Number(token('--hud-opacity-meta'))).toBeGreaterThanOrEqual(0.6);
    expect(Number(token('--hud-opacity-meta'))).toBeLessThanOrEqual(0.65);
  });
  it('layout constants match the CSS: icon 24 + 10, aside 46% max, 4px row gap', () => {
    expect(parseFloat(token('--hud-icon-size'))).toBe(ICON_PX);
    expect(parseFloat(token('--hud-icon-gap'))).toBe(ICON_GAP_PX);
    const hud = css('hud-kit.css');
    expect(hud).toMatch(/\.hud-line__aside \{[^}]*max-width: 46%/);
    expect(ASIDE_MAX_PX).toBe(Math.floor(CARD_INNER_WIDTH * 0.46));
    expect(hud).toMatch(/\.hud-card__content > \* \+ \* \{\s*margin-top: 4px/);
    expect(ROW_GAP_PX).toBe(4);
  });
});

describe('copy audit (worst-case inputs, real font metrics)', { timeout: 60_000 }, () => {
  const all = allCopy();
  it('G3 "Not on your list" is in the audited set', () => {
    expect(all.some((c) => c.id.includes('/G3/') && c.id.includes('/unassigned/') && c.rows.some((r) => r.text === 'Not on your list'))).toBe(true);
  });
  it('covers every screen at scale', () => {
    expect(all.length).toBeGreaterThan(5000);
    for (const id of SCREEN_IDS) expect(all.some((c) => c.id.includes(`/${id}/`))).toBe(true);
  });
  it('every card line (icon + text + aside) fits 528px with the real font', () => {
    const bad: string[] = [];
    let measured = 0;
    let widest = 0;
    for (const c of all) {
      for (const row of c.rows) {
        const w = rowWidth(row);
        measured++;
        widest = Math.max(widest, w);
        if (w > CARD_INNER_WIDTH - 1) bad.push(`${c.id} ${row.role} "${row.text}"${row.aside ? ` | "${row.aside.text}"` : ''} = ${w.toFixed(1)}px`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(measured).toBeGreaterThan(20000);
    expect(widest).toBeLessThanOrEqual(CARD_INNER_WIDTH);
  });
  it('an aside never exceeds its 46% box and never needs an ellipsis in the browser', () => {
    for (const c of all) {
      for (const row of c.rows) {
        if (!row.aside) continue;
        const box = (row.aside.icon ? ICON_PX + ASIDE_ICON_GAP_PX : 0) + real(row.aside.text, ASIDE_STYLE.size, ASIDE_STYLE.weight);
        expect(box, `${c.id} "${row.aside.text}"`).toBeLessThanOrEqual(ASIDE_MAX_PX);
      }
    }
  });
  it('status strip: left + 16px + right items fit 560px with the real font (clock only when it fits)', () => {
    const bad: string[] = [];
    let withClock = 0;
    let withoutClock = 0;
    for (const c of all) {
      const { left, right } = stripWidth(c);
      if (left + STRIP_GAP_PX + right > STRIP_W - SAFETY_PX + 1) bad.push(`${c.id} "${c.left}" ${left.toFixed(1)} + ${right.toFixed(1)}`);
      if (c.items.some((i) => i.key === 'clock')) withClock++;
      else withoutClock++;
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(withClock).toBeGreaterThan(0); // the clock shows whenever there is room
    expect(withoutClock).toBeGreaterThan(0); // and is dropped (never the name or the mic) when there is not
  });
  it('the strip keeps connection first; Listening appears only with the live-mic flag; offline says Not linked', () => {
    for (const c of all) {
      expect(c.items[0].key).toBe('conn');
    }
    const listeningCases = all.filter((c) => c.items.some((i) => i.key === 'listening'));
    expect(listeningCases.length).toBeGreaterThan(0);
    const flag = (c: Case) => (c.id.startsWith('idle/') ? c.id.split('/')[2] : c.id.split('/')[6]);
    expect(listeningCases.every((c) => flag(c) === 'true')).toBe(true);
    expect(all.filter((c) => flag(c) === 'true').every((c) => c.items.some((i) => i.key === 'listening'))).toBe(true);
    expect(all.some((c) => c.items[0].text === 'Not linked' && c.items[0].icon === 'link-off')).toBe(true);
  });
  it('every character of every screen exists in the Nunito cmap (icons are SVG, no fallback-font glyphs)', () => {
    expect([...MISSING].sort()).toEqual([]);
  });
  it('covers the allergy alert: Allergy label, hero-height diamond beside the allergen, one plain line, "Say acknowledge"', () => {
    const a = all.find((c) => c.alert && c.rows[2]?.text.startsWith('Chart lists'));
    expect(a).toBeDefined();
    expect(a!.rows.map((r) => r.role)).toEqual(['label', 'hero', 'body', 'hint']);
    expect(a!.rows[0]).toMatchObject({ text: 'Allergy' });
    expect(a!.rows[1]).toMatchObject({ icon: 'diamond', iconPx: 36 });
    expect(['Say "acknowledge"', 'Mic off · hold to acknowledge']).toContain(a!.rows[3].text);
  });
  it('no card exceeds 4 lines or the 124px inner height, no wall of text, and no ALL CAPS', () => {
    for (const c of all) {
      expect(c.rows.length).toBeLessThanOrEqual(4);
      const h = c.rows.reduce((sum, r) => sum + ROLE_STYLE[r.role].lineHeight, 0) + ROW_GAP_PX * (c.rows.length - 1);
      expect(h, c.id).toBeLessThanOrEqual(CARD_INNER_HEIGHT);
      expect(c.rows.filter((r) => r.role === 'hero').length).toBeLessThanOrEqual(1);
      for (const r of c.rows) {
        expect(/\b[A-Z]{4,}\b/.test(r.text), c.id + ' ' + r.text).toBe(false);
      }
    }
  });
  it('FRD section 2 strings render verbatim', () => {
    const texts = new Set(all.flatMap((c) => c.rows.flatMap((r) => [r.text, r.aside?.text ?? ''])));
    for (const t of ['Due now · Gluc 182 (11:00a)', 'Not on your list', "Photo not sent · say 'retry'", 'Queued · offline', 'Say "done" · +1 due ("next")', 'Try "done", "vitals", or "close"']) {
      expect(texts.has(t), t).toBe(true);
    }
  });
  it('progress: the stepper has 2-8 dots and the bar is a 0..1 fraction', () => {
    for (const c of all) {
      if (!c.progress) continue;
      if (c.progress.kind === 'steps') {
        expect(c.progress.total).toBeGreaterThanOrEqual(2);
        expect(c.progress.total).toBeLessThanOrEqual(8);
        expect(c.progress.index).toBeLessThan(c.progress.total);
      } else {
        expect(c.progress.fraction).toBeGreaterThanOrEqual(0);
        expect(c.progress.fraction).toBeLessThanOrEqual(1);
      }
    }
    expect(all.some((c) => c.progress?.kind === 'steps')).toBe(true);
    expect(all.some((c) => c.progress?.kind === 'bar')).toBe(true);
  });
});
