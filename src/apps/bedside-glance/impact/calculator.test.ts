import { describe, expect, it } from 'vitest';
import { DEFAULTS, SHIFT_MINUTES, clampInputs, computeOutputs, formatMonths, formatUsd, type CalcInputs } from './calculator';

const base: CalcInputs = { ...DEFAULTS };
const withInputs = (patch: Partial<CalcInputs>): CalcInputs => ({ ...base, ...patch });

describe('computeOutputs at defaults', () => {
  const o = computeOutputs(base);

  it('derives loaded cost per paid minute from cost / (shifts x 720 min)', () => {
    // 143,300 / (173 x 720) = 1.15045...
    expect(o.costPerNurseMinute).toBeCloseTo(143300 / (173 * 720), 10);
    expect(o.costPerNurseMinute).toBeCloseTo(1.1505, 3);
  });

  it('values one nurse at 15 min x 173 shifts x $/min x 50% capture', () => {
    expect(o.valuePerNurseYear).toBeCloseTo(15 * 143300 / 720 * 0.5, 6); // ~1,492.71
    expect(o.valuePerDeviceYear).toBe(o.valuePerNurseYear);
  });

  it('pays back a $450 device in about 3.6 months', () => {
    expect(o.paybackMonthsPerDevice).toBeCloseTo(450 / (o.valuePerNurseYear / 12), 6);
    expect(o.paybackMonthsPerDevice).toBeCloseTo(3.62, 2);
  });

  it('counts devices: 30 per unit, 30 for one unit, 100 for 500 beds at 5 beds per nurse', () => {
    expect(o.devicesPerUnit).toBe(30);
    expect(o.devicesAllUnits).toBe(30);
    expect(o.hospitalDevices).toBe(100);
  });

  it('totals unit and hospital annual value', () => {
    expect(o.unitAnnualValue).toBeCloseTo(o.valuePerNurseYear * 30, 6);
    expect(o.hospitalAnnualValue).toBeCloseTo(o.valuePerNurseYear * 100, 6);
  });

  it('computes break-even minutes for the entered price (about 4.5 min/shift at $450)', () => {
    expect(o.breakEvenMinutesPerShift).toBeCloseTo(450 / (173 * (143300 / 124560) * 0.5), 6);
    expect(o.breakEvenMinutesPerShift).toBeCloseTo(4.52, 2);
  });
});

describe('edge cases', () => {
  it('0 minutes saved: no value, payback n/a, break-even still defined', () => {
    const o = computeOutputs(withInputs({ minutesPerShift: 0 }));
    expect(o.valuePerNurseYear).toBe(0);
    expect(o.paybackMonthsPerDevice).toBeNull();
    expect(o.unitAnnualValue).toBe(0);
    expect(o.breakEvenMinutesPerShift).toBeCloseTo(4.52, 2);
  });

  it('0 price: payback is 0 and break-even is 0 (no divide by zero)', () => {
    const o = computeOutputs(withInputs({ devicePriceUsd: 0 }));
    expect(o.paybackMonthsPerDevice).toBe(0);
    expect(o.breakEvenMinutesPerShift).toBe(0);
    expect(o.valuePerNurseYear).toBeGreaterThan(0);
  });

  it('100% capture doubles the value of 50% capture', () => {
    const half = computeOutputs(base);
    const full = computeOutputs(withInputs({ capturePct: 100 }));
    expect(full.valuePerNurseYear).toBeCloseTo(half.valuePerNurseYear * 2, 6);
    expect(full.breakEvenMinutesPerShift).toBeCloseTo(half.breakEvenMinutesPerShift! / 2, 6);
  });

  it('0% capture: no value, payback n/a, break-even n/a (no divide by zero)', () => {
    const o = computeOutputs(withInputs({ capturePct: 0 }));
    expect(o.valuePerNurseYear).toBe(0);
    expect(o.paybackMonthsPerDevice).toBeNull();
    expect(o.breakEvenMinutesPerShift).toBeNull();
  });

  it('0 shifts per year: cost per minute 0 and break-even n/a', () => {
    const o = computeOutputs(withInputs({ shiftsPerYear: 0 }));
    expect(o.costPerNurseMinute).toBe(0);
    expect(o.valuePerNurseYear).toBe(0);
    expect(o.breakEvenMinutesPerShift).toBeNull();
  });

  it('0 beds per nurse: hospital device count and value are n/a', () => {
    const o = computeOutputs(withInputs({ bedsPerNurseOnShift: 0 }));
    expect(o.hospitalDevices).toBeNull();
    expect(o.hospitalAnnualValue).toBeNull();
    expect(o.unitAnnualValue).not.toBeNull();
  });

  it('huge inputs are clamped and every output stays finite', () => {
    const huge = withInputs({
      nursesPerUnit: 1e300,
      units: Number.MAX_VALUE,
      minutesPerShift: Number.POSITIVE_INFINITY,
      capturePct: 1e300,
      devicePriceUsd: 1e300,
      loadedCostPerNurseYear: 1e300,
      shiftsPerYear: 1e300,
      bedsPerNurseOnShift: 1e-300,
      hospitalBeds: 1e300,
    });
    const o = computeOutputs(huge);
    for (const v of Object.values(o)) {
      if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
    expect(clampInputs(huge).minutesPerShift).toBe(SHIFT_MINUTES);
    expect(clampInputs(huge).capturePct).toBe(100);
  });

  it('negative and NaN inputs clamp to the lower bound', () => {
    const c = clampInputs(withInputs({ devicePriceUsd: -5, minutesPerShift: Number.NaN }));
    expect(c.devicePriceUsd).toBe(0);
    expect(c.minutesPerShift).toBe(0);
  });

  it('minutes above a 720-minute shift are clamped to 720', () => {
    expect(computeOutputs(withInputs({ minutesPerShift: 5000 }))).toEqual(
      computeOutputs(withInputs({ minutesPerShift: SHIFT_MINUTES })),
    );
  });

  it('fractional nurses and units round up to whole devices', () => {
    const o = computeOutputs(withInputs({ nursesPerUnit: 4.2, units: 1.5 }));
    expect(o.devicesPerUnit).toBe(5);
    expect(o.devicesAllUnits).toBe(10);
  });
});

describe('formatting', () => {
  it('renders null as n/a and zero payback as a free device', () => {
    expect(formatUsd(null)).toBe('n/a');
    expect(formatMonths(null)).toBe('n/a');
    expect(formatMonths(0)).toBe('0 (free device)');
    expect(formatUsd(1492.7)).toBe('$1,493');
  });
});

describe('running costs and device life', () => {
  it('has editable running cost (software+MDM+cleaning per device per year) and device life inputs', () => {
    expect(DEFAULTS.runningCostPerDeviceYear).toBeGreaterThan(0);
    expect(DEFAULTS.deviceLifeYears).toBeGreaterThan(0);
  });
  it('device-only payback ignores running costs (unchanged)', () => {
    const a = computeOutputs(withInputs({ runningCostPerDeviceYear: 0 }));
    const b = computeOutputs(withInputs({ runningCostPerDeviceYear: 500 }));
    expect(b.paybackMonthsPerDevice).toBeCloseTo(a.paybackMonthsPerDevice!, 9);
  });
  it('payback with running costs = price / ((value - running) / 12)', () => {
    const o = computeOutputs(withInputs({ runningCostPerDeviceYear: 500 }));
    expect(o.paybackMonthsWithRunning).toBeCloseTo(450 / ((o.valuePerNurseYear - 500) / 12), 6);
    expect(o.paybackMonthsWithRunning!).toBeGreaterThan(o.paybackMonthsPerDevice!);
  });
  it('never pays back when running cost >= annual value (null, no divide by zero)', () => {
    const o = computeOutputs(withInputs({ runningCostPerDeviceYear: 1_000_000 }));
    expect(o.paybackMonthsWithRunning).toBeNull();
    expect(o.netValuePerDeviceYear).toBeLessThan(0);
  });
  it('net value per device-year = value - running - price / life', () => {
    const o = computeOutputs(withInputs({ runningCostPerDeviceYear: 200, deviceLifeYears: 3 }));
    expect(o.netValuePerDeviceYear).toBeCloseTo(o.valuePerNurseYear - 200 - 450 / 3, 6);
  });
  it('zero device life does not divide by zero (clamped to the 0.5 year floor)', () => {
    const o = computeOutputs(withInputs({ deviceLifeYears: 0 }));
    expect(Number.isFinite(o.netValuePerDeviceYear)).toBe(true);
  });
  it('free device with no running cost pays back at 0 months', () => {
    expect(computeOutputs(withInputs({ devicePriceUsd: 0, runningCostPerDeviceYear: 0 })).paybackMonthsWithRunning).toBe(0);
  });
});
