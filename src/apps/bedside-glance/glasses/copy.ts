// Every string the glasses show is built here, so the copy-audit test measures exactly what renders.
// Strings marked [FRD s2] are locked copy and must stay verbatim.
// Type: Nunito (heavy rounded sans), sentence case. Widths are measured in pixels with metrics.ts (real font advances),
// so text is clipped to fit instead of relying on CSS ellipsis.
import { hhmmToMinutes, longTime, shortTime } from '../../../../shared/clock';
import type { HudIconName } from '../../../hud-kit/components/Icon';
import { CARD_INNER_WIDTH } from '../../../hud-kit/layout';
import { measure } from './metrics';
import {
  currentPatient, demoNowMin, dueMeds, nextMed, shownMed, FADE_MS, MISS_TOAST, NOT_ON_LIST, OFFLINE_QUEUED, PHOTO_FAILED,
  type GState, type Patient,
} from './stateMachine';

export type Role = 'label' | 'hero' | 'body' | 'hint' | 'meta';
export interface Aside { text: string; icon?: HudIconName; strong?: boolean }
export interface Row { role: Role; text: string; icon?: HudIconName; /** Icon size in px when not the default 24 (hero-height alert diamond). */ iconPx?: number; aside?: Aside }
export interface StripItem { key: 'conn' | 'listening' | 'clock'; text: string; icon?: HudIconName; strong?: boolean }
export type Progress = { kind: 'bar'; fraction: number } | { kind: 'steps'; index: number; total: number };
export interface ScreenCopy {
  /** Identity text on the left of the strip. */
  left: string;
  /** Connection, live mic and (when it fits) the clock, in order. */
  items: StripItem[];
  rows: Row[];
  /** Critical Allergy uses the alert colour, longer 3px ticks and a dimmed strip. */
  alert?: boolean;
  /** Progress along the card's bottom edge: dot stepper for "n of m" due, drain bar for the undo window. */
  progress?: Progress;
}

/** Type roles: px size, weight and line height, mirrored by tokens.css (the audit checks both). */
export const ROLE_STYLE: Record<Role, { size: number; weight: 600 | 700; lineHeight: number }> = {
  label: { size: 20, weight: 700, lineHeight: 22 },
  hero: { size: 36, weight: 700, lineHeight: 40 },
  body: { size: 22, weight: 600, lineHeight: 26 },
  hint: { size: 20, weight: 600, lineHeight: 24 },
  meta: { size: 20, weight: 600, lineHeight: 22 },
};
export const ASIDE_STYLE = { size: 20, weight: 600 } as const;
export const STRIP_LEFT_STYLE = { size: 22, weight: 700 } as const;
export const STRIP_RIGHT_STYLE = { size: 20, weight: 600 } as const;

export const ICON_PX = 24;
/** The alert diamond sits at hero height. */
export const HERO_ICON_PX = 36;
export const ICON_GAP_PX = 10; // leading icon margin
export const ASIDE_ICON_GAP_PX = 8;
export const ASIDE_MARGIN_PX = 16;
export const ASIDE_MAX_PX = Math.floor(CARD_INNER_WIDTH * 0.46); // CSS max-width: 46%
export const STRIP_W = 560;
export const STRIP_GAP_PX = 16;
export const STRIP_ICON_GAP_PX = 6;
export const ITEM_GAP_PX = 16;
/** Pixels kept free so a rounding difference in the browser never triggers an ellipsis. */
export const SAFETY_PX = 2;
/** Card inner height: 140 - 2 x 8 padding. */
export const CARD_INNER_HEIGHT = 124;
export const ROW_GAP_PX = 4;
export const UNAVAILABLE_NOTICE = 'Assessment unavailable: no photo captured';
/** The undo window the server enforces (server/sessionStore.ts UNDO_WINDOW_MS). */
export const UNDO_WINDOW_MS = 10_000;

/** Longest prefix of `text` that fits `maxPx`, with an ellipsis when something was cut. */
export function clipPx(text: string, maxPx: number, size: number, weight: 600 | 700): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (measure(t, size, weight) <= maxPx) return t;
  const chars = Array.from(t);
  while (chars.length > 1 && measure(`${chars.join('').trimEnd()}…`, size, weight) > maxPx) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

export function asideBoxPx(a: Aside): number {
  return (a.icon ? ICON_PX + ASIDE_ICON_GAP_PX : 0) + measure(a.text, ASIDE_STYLE.size, ASIDE_STYLE.weight);
}

/** Pixels a row's icon + aside take from the line (0 when it has neither). */
export function rowChromePx(r: Pick<Row, 'icon' | 'iconPx' | 'aside'>): number {
  let w = r.icon ? (r.iconPx ?? ICON_PX) + ICON_GAP_PX : 0;
  if (r.aside) w += ASIDE_MARGIN_PX + asideBoxPx(r.aside);
  return w;
}

function row(role: Role, text: string, opts: { icon?: HudIconName; iconPx?: number; aside?: Aside } = {}): Row {
  const st = ROLE_STYLE[role];
  let aside = opts.aside;
  if (aside) {
    const room = ASIDE_MAX_PX - (aside.icon ? ICON_PX + ASIDE_ICON_GAP_PX : 0) - SAFETY_PX;
    aside = { ...aside, text: clipPx(aside.text, room, ASIDE_STYLE.size, ASIDE_STYLE.weight) };
  }
  const chrome = rowChromePx({ icon: opts.icon, iconPx: opts.iconPx, aside });
  const out: Row = { role, text: clipPx(text, CARD_INNER_WIDTH - chrome - SAFETY_PX, st.size, st.weight) };
  if (opts.icon) out.icon = opts.icon;
  if (opts.iconPx) out.iconPx = opts.iconPx;
  if (aside) out.aside = aside;
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms)\.)\s+/).map((x) => x.trim()).filter(Boolean);
}

function capitalise(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Maria Lopez" -> "Maria L." */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : name;
}

export function itemPx(it: StripItem): number {
  return (it.icon ? ICON_PX + STRIP_ICON_GAP_PX : 0) + measure(it.text, STRIP_RIGHT_STYLE.size, STRIP_RIGHT_STYLE.weight);
}
export function itemsPx(items: StripItem[]): number {
  return items.reduce((n, it) => n + itemPx(it), 0) + ITEM_GAP_PX * Math.max(0, items.length - 1);
}

/** Left (75%): "Rm 12 · Maria L." or the brand word. Right: connection and clock at 60%; Listening (75%) only while the mic is live; Not linked at 75%. */
export function statusStrip(s: GState, nowMs: number): { left: string; items: StripItem[] } {
  const nowMin = demoNowMin(s.session, nowMs);
  const base: StripItem[] = [
    s.offline ? { key: 'conn', text: 'Not linked', icon: 'link-off', strong: true } : { key: 'conn', text: 'Linked', icon: 'link' },
  ];
  if (s.listening) base.push({ key: 'listening', text: 'Listening', icon: 'mic', strong: true });
  const withClock: StripItem[] = [...base, { key: 'clock', text: shortTime(nowMin) }];
  const p = currentPatient(s);
  const fits = (t: string, items: StripItem[]) =>
    measure(t, STRIP_LEFT_STYLE.size, STRIP_LEFT_STYLE.weight) + STRIP_GAP_PX + itemsPx(items) + SAFETY_PX <= STRIP_W;
  if (!p) return { left: 'Bedside Glance', items: fits('Bedside Glance', withClock) ? withClock : base };
  const full = `Rm ${p.room} · ${p.name}`;
  const short = `Rm ${p.room} · ${shortName(p.name)}`;
  for (const items of [withClock, base]) {
    for (const t of [full, short]) if (fits(t, items)) return { left: t, items };
  }
  const room = STRIP_W - STRIP_GAP_PX - itemsPx(base) - SAFETY_PX;
  return { left: clipPx(short, room, STRIP_LEFT_STYLE.size, STRIP_LEFT_STYLE.weight), items: base };
}

function allergyList(p: Patient): string {
  return p.allergies.length ? p.allergies.join(', ') : 'none';
}

/** The chart allergy as a short aside on the action line: diamond + "Allergy: Penicillin" when it fits, else just the name. */
function allergyAside(p: Patient, hint: string): Aside {
  if (!p.allergies.length) return { text: 'No allergies listed' };
  const name = p.allergies.length > 1 ? `${p.allergies[0]} +${p.allergies.length - 1}` : p.allergies[0];
  const roomPx = CARD_INNER_WIDTH - SAFETY_PX - ASIDE_MARGIN_PX - measure(hint, ROLE_STYLE.hint.size, ROLE_STYLE.hint.weight);
  const full: Aside = { text: `Allergy: ${name}`, icon: 'diamond', strong: true };
  return asideBoxPx(full) <= Math.min(roomPx, ASIDE_MAX_PX) ? full : { text: name, icon: 'diamond', strong: true };
}

const CONFLICT_RE = /^Already given/;

function g4(s: GState, p: Patient, nowMs: number): { rows: Row[]; progress?: Progress } {
  const due = dueMeds(s, nowMs);
  const med = shownMed(s, nowMs);
  const next = med ? null : nextMed(s, nowMs);
  const conflict = s.toast && CONFLICT_RE.test(s.toast.text) ? s.toast.text : null;
  if (conflict) {
    // Conflict banner (first write wins): triangle label, the locked sentence at body weight, the card state as meta.
    const hero = med ? `${med.name} ${med.dose}` : next ? `${next.name} ${next.dose}` : 'All meds given';
    const meta = med
      ? `Due now · ${shortTime(hhmmToMinutes(med.dueAt))}`
      : next ? `None due · Next ${next.name} ${shortTime(hhmmToMinutes(next.dueAt))}` : 'None due'; // [FRD s2]
    return { rows: [row('label', 'Already given', { icon: 'triangle' }), row('hero', hero), row('body', conflict), row('meta', meta)] };
  }
  if (!med) {
    if (!next) {
      const hint = 'Say "vitals" or "close"';
      return { rows: [row('label', 'Meds', { icon: 'check' }), row('hero', 'All meds given'), row('body', 'None due'), row('hint', hint, { aside: allergyAside(p, hint) })] };
    }
    const dueMin = hhmmToMinutes(next.dueAt);
    const inMin = Math.max(0, dueMin - Math.floor(demoNowMin(s.session, nowMs)));
    const hint = `Due ${longTime(dueMin)} · in ${inMin} min`; // [FRD s2]
    return {
      rows: [
        row('label', 'Next due', { icon: 'ring' }),
        row('hero', `${next.name} ${next.dose}`),
        row('body', `None due · Next ${next.name} ${shortTime(dueMin)}`), // [FRD s2]
        row('hint', hint, { aside: allergyAside(p, hint) }),
      ],
    };
  }
  const label = row('label', 'Due now', { icon: 'ring', aside: { text: shortTime(hhmmToMinutes(med.dueAt)) } });
  const hint = s.micOff
    ? due.length > 1 ? `Tap to confirm · +${due.length - 1} due (hold)` : 'Tap to confirm'
    : due.length > 1 ? `Say "done" · +${due.length - 1} due ("next")` : 'Say "done"'; // [FRD s2]
  const rows = [label, row('hero', `${med.name} ${med.dose}`)];
  if (p.diabetic && p.glucose) rows.push(row('body', `Due now · Gluc ${p.glucose.valueMgDl} (${shortTime(hhmmToMinutes(p.glucose.takenAt))})`)); // [FRD s2]
  rows.push(row('hint', hint, { aside: allergyAside(p, hint) }));
  if (due.length < 2) return { rows };
  return { rows, progress: { kind: 'steps', index: Math.min(Math.max(s.dueCursor, 0), due.length - 1), total: due.length } };
}

function g6(s: GState, p: Patient, nowMs: number): Row[] {
  const prn = p.prn[0];
  if (!prn) return [row('label', 'PRN', { icon: 'ring' }), row('hero', 'None ordered'), row('hint', 'Say "close"')];
  const eligible = hhmmToMinutes(prn.lastGivenAt) + prn.intervalHours * 60;
  const nowMin = Math.floor(demoNowMin(s.session, nowMs));
  const status = nowMin >= eligible ? 'Eligible now' : `Eligible ${longTime(eligible)} · in ${eligible - nowMin} min`;
  return [
    row('label', 'PRN available', { icon: 'ring', aside: { text: `Last given ${longTime(hhmmToMinutes(prn.lastGivenAt))}` } }),
    row('hero', `${prn.name} ${prn.dose}`),
    row('body', status),
    row('hint', 'Say "close"'),
  ];
}

/** The G7 body line. A nurse-entered dressing replaces the chart default; "per protocol" never invents a due time. */
function woundLine(s: GState, p: Patient, w: NonNullable<Patient['wound']>): string {
  const d = s.session.dressings?.[p.id];
  if (d) return `Changed ${longTime(d.changedMin)} · due ${d.nextDueMin === null ? 'per protocol' : longTime(d.nextDueMin)}`; // [FRD s2]
  const last = hhmmToMinutes(w.lastChangedAt);
  return `Changed ${longTime(last)} · due ${longTime(last + w.intervalHours * 60)}`; // [FRD s2]
}

function g7(s: GState, p: Patient, micOff = false): Row[] {
  const w = p.wound;
  if (!w) return [row('label', 'Wound check', { icon: 'ring' })];
  const site = capitalise(w.site.split(',')[0]);
  return [
    row('label', 'Wound check', { icon: 'ring' }),
    row('hero', site),
    row('body', woundLine(s, p, w)),
    row('hint', micOff ? 'Tap to take photo' : 'Say "photo"'), // the capture intent matches a bare "photo"; a tap works too
  ];
}

function h3(s: GState): Row[] {
  if (s.stage === 'failed') return [row('label', 'Wound photo', { icon: 'triangle' }), row('hero', 'Upload failed'), row('hint', PHOTO_FAILED)]; // [FRD s2]
  if (s.stage === 'assess') return [row('label', 'Wound photo', { icon: 'scan' }), row('hero', 'Assessing…'), row('hint', 'Documentation aid only')];
  return [row('label', 'Wound photo', { icon: 'scan' }), row('hero', 'Hold steady'), row('hint', 'Uploading photo…')];
}

function g8(s: GState): Row[] {
  const a = s.assessment;
  if (!a) return [row('label', 'Wound assessment', { icon: 'ring' }), row('body', 'No assessment')];
  if (a.source === 'unavailable') {
    // Never a clinical finding: only the notice. Nothing to send.
    return [row('label', 'Wound · Unavailable', { icon: 'triangle' }), row('body', 'No clinical finding shown'), row('meta', UNAVAILABLE_NOTICE), row('hint', 'Say "close"')];
  }
  const p = currentPatient(s);
  const last = s.sending ? `Sending to ${p?.attending ?? 'doctor'}…` : s.micOff ? 'Tap to send to phone' : 'Say "send to phone"';
  if (a.source !== 'gemini') {
    // No AI review ran: never show a finding, whatever text came with it. The nurse writes the note on the phone.
    return [
      row('label', 'Wound · Photo only', { icon: 'dot' }),
      row('hero', 'Photo saved'),
      row('body', 'No AI review - see phone'),
      row('hint', last),
    ];
  }
  // Hero = the assessment summary from the real model.
  const parts = sentences(a.finding);
  const detail = parts.length > 1 ? parts.slice(1).join(' ') : a.comparison.trim();
  return [
    row('label', 'Wound · AI result', { icon: 'dot' }),
    row('hero', parts[0] ?? a.finding),
    ...(detail ? [row('body', detail)] : []),
    row('hint', last),
  ];
}

function g9(s: GState): Row[] {
  const n = s.notice;
  if (!n) return [row('label', 'Phone', { icon: 'link' })];
  const parts = sentences(n.text);
  const rows: Row[] = [row('label', n.label ?? 'Phone', { icon: 'link' }), row('hero', parts[0] ?? n.text)];
  if (parts[1]) rows.push(row('body', parts[1]));
  if (parts.length > 2) rows.push(row('meta', parts.slice(2).join(' ')));
  return rows;
}

function vitals(p: Patient): Row[] {
  const v = p.vitals;
  return [
    row('label', 'Vitals', { icon: 'dot', aside: { text: `Taken ${longTime(hhmmToMinutes(v.takenAt))}` } }),
    row('hero', `${v.bp} · HR ${v.hr}`),
    row('body', `Temp ${v.tempF.toFixed(1)} F · SpO2 ${v.spo2}%`),
    row('hint', `Next due ${longTime(hhmmToMinutes(v.nextAt))} · say "close"`),
  ];
}

/** Filled diamond + words + the allergen as hero. States the chart allergy and the drug; never blocks. */
function allergy(s: GState, p: Patient): Row[] {
  const list = allergyList(p);
  return [
    row('label', 'Allergy'),
    row('hero', s.alert?.drug ?? list, { icon: 'diamond', iconPx: HERO_ICON_PX }),
    row('body', `Chart lists ${s.alert?.allergy ?? list} allergy`),
    row('hint', s.micOff ? 'Mic off · hold to acknowledge' : 'Say "acknowledge"'),
  ];
}

function toastRows(rows: Row[], text: string): Row[] {
  const out = rows.slice();
  const last = out.length - 1;
  if (last >= 0 && (out[last].role === 'hint' || out[last].role === 'meta')) out[last] = row('hint', text);
  else out.push(row('hint', text));
  return out;
}

export function screenCopy(s: GState, nowMs: number): ScreenCopy {
  const strip = statusStrip(s, nowMs);
  const p = currentPatient(s);
  let rows: Row[];
  let progress: Progress | undefined;
  switch (s.screen) {
    case 'G1':
      rows = [row('label', 'Ready', { icon: 'scan' }), row('hero', 'Scan wristband'), row('hint', 'Center the band · hold 5 cm away')];
      break;
    case 'G2':
      rows = [row('label', 'Scanning', { icon: 'scan' }), row('hero', 'Hold steady…'), row('hint', 'Keep the band centered')];
      break;
    case 'G3':
      rows = [
        row('label', 'Scan failed', { icon: 'triangle' }),
        row('hero', s.scanFail === 'unassigned' ? NOT_ON_LIST : 'Band not recognized'),
        row('hint', 'Tap to try again'),
      ];
      break;
    case 'G4': {
      if (!p) { rows = [row('hero', 'No patient')]; break; }
      const g = g4(s, p, nowMs);
      rows = g.rows;
      progress = g.progress;
      break;
    }
    case 'G5': {
      const l = s.logged;
      rows = [
        row('label', 'Med logged', { icon: 'check', aside: { text: s.offline ? OFFLINE_QUEUED : `${l?.at ?? ''} · via glasses` } }), // [FRD s2] offline
        row('hero', l?.name ?? ''),
        row('hint', 'Say "undo" within 10s'),
      ];
      if (s.fadeAtMs !== null) {
        const loggedAt = s.fadeAtMs - (FADE_MS.G5 ?? 0);
        progress = { kind: 'bar', fraction: Math.max(0, Math.min(1, (loggedAt + UNDO_WINDOW_MS - nowMs) / UNDO_WINDOW_MS)) };
      }
      break;
    }
    case 'G6': rows = p ? g6(s, p, nowMs) : [row('label', 'PRN', { icon: 'ring' })]; break;
    case 'G7': rows = p ? g7(s, p, s.micOff) : [row('label', 'Wound check', { icon: 'ring' })]; break;
    case 'H3': rows = h3(s); break;
    case 'G8': rows = g8(s); break;
    case 'G9': rows = g9(s); break;
    case 'VITALS': rows = p ? vitals(p) : [row('label', 'Vitals', { icon: 'dot' })]; break;
    case 'ALLERGY': rows = p ? allergy(s, p) : [row('label', 'Allergy', { icon: 'diamond' })]; break;
  }
  const conflictShown = s.screen === 'G4' && !!s.toast && CONFLICT_RE.test(s.toast.text); // already rendered as the banner
  const withToast = s.toast && s.screen !== 'ALLERGY' && !conflictShown ? toastRows(rows, s.toast.text) : rows;
  const out: ScreenCopy = { ...strip, rows: withToast, alert: s.screen === 'ALLERGY' };
  if (progress) out.progress = progress;
  return out;
}

export { MISS_TOAST };
