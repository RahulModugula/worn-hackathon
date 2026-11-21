// Guard: the business-case figures quoted in README, PITCH and the deck builder must equal the
// calculator's output. If a default changes, this fails until the docs are updated.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, RN_MEDIAN_WAGE_USD, computeOutputs, type CalcInputs } from './calculator';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8'); // vitest runs from the repo root
const o = computeOutputs({ ...DEFAULTS } as CalcInputs);
const withRunning = computeOutputs({ ...DEFAULTS, runningCostPerDeviceYear: 120 } as CalcInputs);

const breakEven = o.breakEvenMinutesPerShift!.toFixed(1); // 4.6
const perMinute = o.costPerNurseMinute.toFixed(2); // 1.12
const oneMinutePerShiftYear = Math.round(DEFAULTS.shiftsPerYear * o.costPerNurseMinute); // 194
const loadedK = Math.round(DEFAULTS.loadedCostPerNurseYear / 1000); // 139
const valueRounded = (Math.round(o.valuePerNurseYear / 10) * 10).toLocaleString('en-US'); // 1,450
const payback = o.paybackMonthsPerDevice!.toFixed(1); // 3.7
const paybackRunning = withRunning.paybackMonthsWithRunning!.toFixed(1); // 4.1

describe('docs quote the calculator, not hand-typed numbers', () => {
  it('uses the BLS May 2025 RN median and drops the old wage', () => {
    expect(RN_MEDIAN_WAGE_USD).toBe(97_550);
    for (const f of ['README.md', 'docs/PITCH.md', 'scripts/build-decks.mjs']) {
      const t = read(f);
      expect(t, f).toContain('$97,550');
      expect(t, f).not.toContain('100,220');
      expect(t, f).not.toContain('$143K');
    }
  });

  it('README quotes the computed break-even, per-minute value, payback and market', () => {
    const t = read('README.md');
    expect(t).toContain(`about ${breakEven} minutes saved per shift`);
    expect(t).toContain(`$${perMinute} per minute`);
    expect(t).toContain(`$${loadedK}K a year loaded`);
    expect(t).toContain(`about $${oneMinutePerShiftYear} a year per nurse`);
    expect(t).toContain(`about ${payback} months (${paybackRunning} months with`);
    expect(t).toContain('3,465,400');
    expect(t).toContain('59%');
  });

  it('PITCH quotes the computed loaded cost, value and break-even', () => {
    const t = read('docs/PITCH.md');
    expect(t).toContain(`$${loadedK}K/yr loaded`);
    expect(t).toContain(`$${oneMinutePerShiftYear}/yr per nurse`);
    expect(t).toContain(`$${valueRounded}/nurse/year`);
    expect(t).toContain(`about ${breakEven} minutes saved per shift`);
    expect(t).toContain('3,465,400');
  });

  it('deck builder quotes the computed figures', () => {
    const t = read('scripts/build-decks.mjs');
    expect(t).toContain(`Roughly ${breakEven} minutes per shift.`);
    expect(t).toContain(`about $${oneMinutePerShiftYear} / yr`);
    expect(t).toContain(`about $${valueRounded} / nurse / yr`);
    expect(t).toContain(`about $${loadedK}K / yr`);
  });
});
