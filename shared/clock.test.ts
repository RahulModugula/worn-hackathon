import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_START_MIN,
  demoMinutes,
  hhmmToMinutes,
  isActionable,
  longTime,
  minutesUntil,
  shortTime,
} from './clock';

type Patients = {
  patients: Array<{
    meds: Array<{ name: string; dueAt: string }>;
    prn: Array<{ name: string; lastGivenAt: string; intervalHours: number }>;
  }>;
};

const data: Patients = JSON.parse(
  readFileSync(resolve(__dirname, '../data/patients.json'), 'utf8'),
);
const [maria, james] = data.patients;
const SHIFT_START = 1_700_000_000_000;
const atShiftStart = (offsetMin = 0) => demoMinutes(SHIFT_START, SHIFT_START, offsetMin);
const med = (list: Patients['patients'][number], name: string) => {
  const m = list.meds.find((x) => x.name === name);
  if (!m) throw new Error(`missing med ${name}`);
  return m;
};

describe('demo clock at shift start (1:42 PM)', () => {
  it('starts at 822 minutes', () => {
    expect(DEMO_START_MIN).toBe(822);
    expect(atShiftStart()).toBe(822);
    expect(longTime(atShiftStart())).toBe('1:42 PM');
  });

  it('Metformin is 18 minutes away and actionable', () => {
    const due = hhmmToMinutes(med(maria, 'Metformin').dueAt);
    const m = minutesUntil(due, atShiftStart());
    expect(m).toBe(18);
    expect(isActionable(m)).toBe(true);
  });

  it('Aspirin is 28 minutes away and actionable', () => {
    const due = hhmmToMinutes(med(james, 'Aspirin').dueAt);
    const m = minutesUntil(due, atShiftStart());
    expect(m).toBe(28);
    expect(isActionable(m)).toBe(true);
  });

  it('Atorvastatin is 48 minutes away and not actionable', () => {
    const due = hhmmToMinutes(med(james, 'Atorvastatin').dueAt);
    const m = minutesUntil(due, atShiftStart());
    expect(m).toBe(48);
    expect(isActionable(m)).toBe(false);
  });

  it('Oxycodone PRN (last 10:15 AM + 4h) is 33 minutes away', () => {
    const prn = maria.prn[0];
    const nextDue = hhmmToMinutes(prn.lastGivenAt) + prn.intervalHours * 60;
    expect(longTime(nextDue)).toBe('2:15 PM');
    expect(minutesUntil(nextDue, atShiftStart())).toBe(33);
  });

  it('with a +30 minute Director offset, Atorvastatin becomes actionable', () => {
    const due = hhmmToMinutes(med(james, 'Atorvastatin').dueAt);
    const m = minutesUntil(due, atShiftStart(30));
    expect(m).toBe(18);
    expect(isActionable(m)).toBe(true);
  });
});

describe('demoMinutes', () => {
  it('advances 1:1 with real time', () => {
    expect(demoMinutes(SHIFT_START, SHIFT_START + 5 * 60_000 + 59_999)).toBe(827);
  });

  it('clamps times before shift start to the start', () => {
    expect(demoMinutes(SHIFT_START, SHIFT_START - 120_000)).toBe(822);
  });
});

describe('formatters', () => {
  it('shortTime uses the compact a/p suffix', () => {
    expect(shortTime(hhmmToMinutes('11:00'))).toBe('11:00a');
    expect(shortTime(hhmmToMinutes('14:10'))).toBe('2:10p');
    expect(shortTime(0)).toBe('12:00a');
  });

  it('longTime uses AM/PM', () => {
    expect(longTime(hhmmToMinutes('09:00'))).toBe('9:00 AM');
    expect(longTime(hhmmToMinutes('21:00'))).toBe('9:00 PM');
    expect(longTime(hhmmToMinutes('12:00'))).toBe('12:00 PM');
  });

  it('hhmmToMinutes rejects malformed input', () => {
    expect(() => hhmmToMinutes('2:00 PM')).toThrow(RangeError);
    expect(() => hhmmToMinutes('24:00')).toThrow(RangeError);
  });
});
