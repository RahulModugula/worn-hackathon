import { describe, expect, it } from 'vitest';
import { buildHandoff, type HandoffPatient, type HandoffStateLike } from './handoff';
import type { ExtraOrder, FeedEntry } from './types';

const maria: HandoffPatient = {
  id: 'P-1012', name: 'Maria Lopez', room: '12', attending: 'Dr. Okafor', allergies: ['Penicillin'],
  meds: [
    { id: 'M-1', name: 'Metformin', dose: '500 mg', dueAt: '14:00' },
    { id: 'M-2', name: 'Lisinopril', dose: '10 mg', dueAt: '18:00' },
    { id: 'M-9', name: 'Statin', dose: '20 mg', dueAt: '23:30' },
  ],
  prn: [{ id: 'PRN-1', name: 'Oxycodone', dose: '5 mg', lastGivenAt: '10:15', intervalHours: 4 }],
  wound: { lastChangedAt: '09:00', intervalHours: 12 },
};
const NOW = 822; // 1:42 PM
const state = (over: Partial<HandoffStateLike> = {}): HandoffStateLike => ({ medStatus: {}, woundCaptures: [], feed: [], ...over });
const fe = (over: Partial<FeedEntry>): FeedEntry => ({ seq: 1, atMs: 0, kind: 'med_given', device: 'glasses', patientId: 'P-1012', timeLabel: '1:30 PM', chain: [], ...over });

describe('buildHandoff (I-PASS, deterministic)', () => {
  it('illness severity is "Not stated" unless the nurse selected one, never computed', () => {
    const none = buildHandoff(state(), maria, [], NOW);
    expect(none.find((i) => i.section === 'I')?.text).toBe('Illness severity: Not stated');
    const sev = buildHandoff(state(), maria, [], NOW, 'Watch');
    expect(sev.find((i) => i.section === 'I')?.text).toBe('Illness severity: Watch');
    // Even a patient with an allergy conflict and overdue meds is never graded.
    expect(buildHandoff(state(), { ...maria, allergies: ['Penicillin', 'Sulfa'] }, [], NOW + 600).find((i) => i.section === 'I')?.text).toBe('Illness severity: Not stated');
  });

  it('P: name, room, allergies (critical) and attending', () => {
    const p = buildHandoff(state(), maria, [], NOW).filter((i) => i.section === 'P');
    expect(p.map((i) => i.text)).toEqual(['Maria Lopez · Rm 12', 'Allergies: Penicillin', 'Attending: Dr. Okafor']);
    expect(p.map((i) => i.critical)).toEqual([false, true, false]);
  });

  it('no allergy on chart is a non-critical line', () => {
    const p = buildHandoff(state(), { ...maria, allergies: [] }, [], NOW).filter((i) => i.section === 'P');
    expect(p[1]).toEqual({ section: 'P', text: 'No allergies on chart', critical: false });
  });

  it('A: ungiven meds due in the next 4 h (and overdue), PRN eligible time, nothing beyond the window', () => {
    const a = buildHandoff(state({ medStatus: { 'P-1012:M-9': { status: 'given' } } }), maria, [], NOW).filter((i) => i.section === 'A').map((i) => i.text);
    expect(a).toContain('Metformin 500 mg due 2:00 PM');
    // 18:00 is 258 min from 13:42 -> outside the 240 min window, so it must not be listed.
    expect(a.some((t) => t.startsWith('Lisinopril'))).toBe(false);
    expect(a).toContain('Oxycodone 5 mg PRN eligible 2:15 PM');
  });

  it('A: a given med is not on the action list; an overdue ungiven med is flagged', () => {
    const given = buildHandoff(state({ medStatus: { 'P-1012:M-1': { status: 'given' } } }), maria, [], NOW).filter((i) => i.section === 'A').map((i) => i.text);
    expect(given.some((t) => t.startsWith('Metformin'))).toBe(false);
    const overdue = buildHandoff(state(), maria, [], NOW + 30).filter((i) => i.section === 'A').map((i) => i.text);
    expect(overdue).toContain('Metformin 500 mg overdue since 2:00 PM');
  });

  it('A: PRN already eligible reads "eligible now"', () => {
    const a = buildHandoff(state(), maria, [], 15 * 60).filter((i) => i.section === 'A').map((i) => i.text);
    expect(a).toContain('Oxycodone 5 mg PRN eligible now');
  });

  it('A: an allergy-conflicting order is a critical action item', () => {
    const order: ExtraOrder = { id: 'X-1', name: 'Amoxicillin', dose: '250 mg', route: 'PO', dueAt: '13:42', allergyClasses: ['penicillin'] };
    const a = buildHandoff(state(), maria, [order], NOW).filter((i) => i.section === 'A');
    const hit = a.find((i) => i.text.startsWith('Amoxicillin'))!;
    expect(hit.text).toBe('Amoxicillin 250 mg due 1:42 PM · Chart lists Penicillin allergy');
    expect(hit.critical).toBe(true);
  });

  it('A: dressing due from a capture dressing (nurse-documented), else from the chart interval', () => {
    const withDressing = state({ woundCaptures: [{ patientId: 'P-1012', dressing: { type: 'hydrogel', nextDueMin: 21 * 60 } }] });
    expect(buildHandoff(withDressing, maria, [], NOW).filter((i) => i.section === 'A').map((i) => i.text)).toContain('Dressing (hydrogel) due 9:00 PM');
    const chart = buildHandoff(state(), maria, [], NOW).filter((i) => i.section === 'A').map((i) => i.text);
    expect(chart).toContain('Dressing due 9:00 PM (chart)');
    const perProtocol = state({ woundCaptures: [{ patientId: 'P-1012', dressing: { type: 'foam', nextDueMin: null } }] });
    expect(buildHandoff(perProtocol, maria, [], NOW).filter((i) => i.section === 'A').map((i) => i.text)).toContain('Dressing (foam) per protocol');
  });

  it('S: meds given with time and via from the feed; critical only within the last 4 h', () => {
    const feed = [
      fe({ seq: 1, medName: 'Metformin', timeLabel: '1:30 PM', chain: ['Nurse confirmed via voice', 'Server accepted'] }),
      fe({ seq: 2, medName: 'Aspirin', timeLabel: '8:00 AM', chain: ['Nurse confirmed via phone', 'Server accepted'] }),
    ];
    const s = buildHandoff(state({ feed }), maria, [], NOW).filter((i) => i.section === 'S');
    expect(s[0]).toEqual({ section: 'S', text: 'Metformin given 1:30 PM via voice', critical: true });
    expect(s[1]).toEqual({ section: 'S', text: 'Aspirin given 8:00 AM via phone', critical: false });
  });

  it('S: an undone med is not reported as given', () => {
    const feed = [
      fe({ seq: 1, medName: 'Metformin', chain: ['Nurse confirmed via voice'] }),
      fe({ seq: 2, kind: 'med_undone', medName: 'Metformin', chain: ['Undone from phone'] }),
    ];
    expect(buildHandoff(state({ feed }), maria, [], NOW).filter((i) => i.section === 'S')).toEqual([]);
  });

  it('S: allergy acknowledgements are critical; wound sent and reply are not', () => {
    const feed = [
      fe({ seq: 1, kind: 'allergy_ack', medName: 'Amoxicillin', timeLabel: '1:41 PM', chain: ['New order (simulated prescriber)', 'Chart lists Penicillin allergy', 'Shown on glasses', 'Acknowledged via voice'] }),
      fe({ seq: 2, kind: 'wound_sent', timeLabel: '1:20 PM', chain: ['Nurse reviewed note', 'Sent to Dr. Okafor', 'Server accepted'] }),
      fe({ seq: 3, kind: 'dr_reply', timeLabel: '1:21 PM', chain: ['Reply from Dr. Okafor', 'Server accepted'] }),
    ];
    const s = buildHandoff(state({ feed }), maria, [], NOW).filter((i) => i.section === 'S');
    expect(s.map((i) => i.text)).toEqual([
      'Allergy alert acknowledged 1:41 PM: Amoxicillin · Chart lists Penicillin allergy',
      'Wound photo sent to Dr. Okafor 1:20 PM',
      'Reply from Dr. Okafor 1:21 PM',
    ]);
    expect(s.map((i) => i.critical)).toEqual([true, false, false]);
  });

  it("S: other patients' feed entries are excluded", () => {
    const feed = [fe({ patientId: 'P-1014', medName: 'Aspirin', chain: ['Nurse confirmed via phone'] })];
    expect(buildHandoff(state({ feed }), maria, [], NOW).filter((i) => i.section === 'S')).toEqual([]);
  });

  it('is deterministic: same input, same output', () => {
    const feed = [fe({ medName: 'Metformin', chain: ['Nurse confirmed via voice'] })];
    const a = buildHandoff(state({ feed }), maria, [], NOW, 'Stable');
    const b = buildHandoff(state({ feed }), maria, [], NOW, 'Stable');
    expect(a).toEqual(b);
  });

  it('time wraps midnight for the 4 h window', () => {
    const late: HandoffPatient = { ...maria, meds: [{ id: 'M-1', name: 'Night med', dose: '5 mg', dueAt: '00:30' }] };
    const a = buildHandoff(state(), late, [], 23 * 60 + 30).filter((i) => i.section === 'A').map((i) => i.text);
    expect(a).toContain('Night med 5 mg due 12:30 AM');
  });
});

describe('buildHandoff with sparse data (nothing is invented)', () => {
  it('a bare patient yields only I and P lines, and sparse feed entries fall back to neutral words', () => {
    const bare: HandoffPatient = { id: 'P-1', name: 'Pat', room: '1' };
    const items = buildHandoff({ medStatus: {}, woundCaptures: [] }, bare, [], 822);
    expect(items.map((i) => i.text)).toEqual(['Illness severity: Not stated', 'Pat · Rm 1', 'No allergies on chart']);
    const feed = [
      fe({ seq: 1, patientId: 'P-1', kind: 'med_given', medName: undefined, chain: [] }),
      fe({ seq: 2, patientId: 'P-1', kind: 'allergy_ack', medName: undefined, chain: [] }),
      fe({ seq: 3, patientId: 'P-1', kind: 'wound_sent', chain: [] }),
      fe({ seq: 4, patientId: 'P-1', kind: 'dr_reply', chain: [] }),
      fe({ seq: 5, patientId: 'P-1', kind: 'wound_captured', chain: [] }),
      fe({ seq: 6, patientId: 'P-1', kind: 'med_given', medName: 'X', timeLabel: 'not a label', chain: ['Nurse confirmed via phone'] }),
    ];
    const s = buildHandoff({ medStatus: {}, woundCaptures: [], feed }, bare, [], 822).filter((i) => i.section === 'S');
    expect(s.map((i) => i.text)).toEqual([
      'Med given 1:30 PM via unknown',
      'X given not a label via phone',
      'Allergy alert acknowledged 1:30 PM: order · Chart lists an allergy',
      'Wound photo sent to the doctor 1:30 PM',
      'Reply from the doctor 1:30 PM',
      'Wound photo captured 1:30 PM',
    ]);
    expect(s[1].critical).toBe(false); // an unparseable time is never called recent
  });
  it('a captured dressing of type none falls back to the chart interval', () => {
    const w = { patientId: 'P-1012', dressing: { type: 'none', nextDueMin: null } };
    expect(buildHandoff(state({ woundCaptures: [w] }), maria, [], NOW).filter((i) => i.section === 'A').map((i) => i.text)).toContain('Dressing due 9:00 PM (chart)');
  });
});
