// Pure impact math for /impact. No React, no DOM. Every number here is either an
// input the reader can edit or a documented default (see sources.ts for badges).

/** ASSUMPTION: a 12-hour paid shift. Cost per minute is loaded cost spread over these minutes. */
export const SHIFT_MINUTES = 720;

export const DEFAULTS = {
  nursesPerUnit: 30,
  units: 1,
  minutesPerShift: 15,
  capturePct: 50,
  devicePriceUsd: 450,
  loadedCostPerNurseYear: 143300,
  shiftsPerYear: 173,
  bedsPerNurseOnShift: 5,
  hospitalBeds: 500,
  runningCostPerDeviceYear: 120,
  deviceLifeYears: 3,
} as const;

export type CalcInputKey = keyof typeof DEFAULTS;
export type CalcInputs = Record<CalcInputKey, number>;

/** Inclusive bounds. Out-of-range values are clamped, never allowed to produce NaN or Infinity. */
export const LIMITS: Record<CalcInputKey, readonly [number, number]> = {
  nursesPerUnit: [0, 100_000],
  units: [0, 100_000],
  minutesPerShift: [0, SHIFT_MINUTES],
  capturePct: [0, 100],
  devicePriceUsd: [0, 1_000_000_000],
  loadedCostPerNurseYear: [0, 1_000_000_000],
  shiftsPerYear: [0, 366],
  bedsPerNurseOnShift: [0, 1_000],
  hospitalBeds: [0, 10_000_000],
  runningCostPerDeviceYear: [0, 1_000_000],
  deviceLifeYears: [0.5, 20],
};

export interface CalcOutputs {
  /** Loaded USD per paid minute of a nurse's shift. */
  costPerNurseMinute: number;
  /** Annual USD value of one nurse's saved minutes, after capture. One device per nurse. */
  valuePerNurseYear: number;
  /** Same as valuePerNurseYear: the value one device returns in a year. */
  valuePerDeviceYear: number;
  /** DEVICE-ONLY payback: price over monthly value, running costs ignored. Null when there is no value. 0 when free. */
  paybackMonthsPerDevice: number | null;
  /** Payback WITH running costs: price over monthly (value minus running cost). Null when running cost >= value (never pays back). */
  paybackMonthsWithRunning: number | null;
  /** Annual value minus running cost minus device price spread over its life. Can be negative. */
  netValuePerDeviceYear: number;
  devicesPerUnit: number;
  devicesAllUnits: number;
  /** Null when beds per nurse on shift is 0. */
  hospitalDevices: number | null;
  unitAnnualValue: number | null;
  hospitalAnnualValue: number | null;
  /** Minutes per shift at which one nurse's captured value equals the device price. Null if undefined. */
  breakEvenMinutesPerShift: number | null;
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Clamp one raw value into its range. NaN becomes the lower bound. */
export function clampInput(key: CalcInputKey, raw: number): number {
  const [lo, hi] = LIMITS[key];
  if (Number.isNaN(raw)) return lo;
  return Math.min(hi, Math.max(lo, raw));
}

export function clampInputs(raw: CalcInputs): CalcInputs {
  const out = { ...DEFAULTS } as CalcInputs;
  for (const key of Object.keys(DEFAULTS) as CalcInputKey[]) {
    out[key] = clampInput(key, raw[key]);
  }
  return out;
}

export function computeOutputs(raw: CalcInputs): CalcOutputs {
  const x = clampInputs(raw);
  const capture = x.capturePct / 100;
  const paidMinutesPerYear = x.shiftsPerYear * SHIFT_MINUTES;

  // Loaded cost per paid minute: annual loaded cost over paid minutes per year.
  const costPerNurseMinute = paidMinutesPerYear > 0 ? x.loadedCostPerNurseYear / paidMinutesPerYear : 0;

  // Saved minutes x shifts x cost per minute x capture.
  const valuePerNurseYear = finiteOrNull(
    x.minutesPerShift * x.shiftsPerYear * costPerNurseMinute * capture,
  ) ?? 0;

  let paybackMonthsPerDevice: number | null;
  if (x.devicePriceUsd === 0) {
    paybackMonthsPerDevice = 0;
  } else if (valuePerNurseYear > 0) {
    paybackMonthsPerDevice = finiteOrNull(x.devicePriceUsd / (valuePerNurseYear / 12));
  } else {
    paybackMonthsPerDevice = null;
  }

  const netOfRunning = valuePerNurseYear - x.runningCostPerDeviceYear;
  let paybackMonthsWithRunning: number | null;
  if (x.devicePriceUsd === 0 && netOfRunning >= 0) {
    paybackMonthsWithRunning = 0;
  } else if (netOfRunning > 0) {
    paybackMonthsWithRunning = finiteOrNull(x.devicePriceUsd / (netOfRunning / 12));
  } else {
    paybackMonthsWithRunning = null;
  }
  const netValuePerDeviceYear = netOfRunning - x.devicePriceUsd / x.deviceLifeYears;

  const devicesPerUnit = Math.ceil(x.nursesPerUnit);
  const devicesAllUnits = devicesPerUnit * Math.ceil(x.units);

  const hospitalDevices = x.bedsPerNurseOnShift > 0
    ? Math.ceil(x.hospitalBeds / x.bedsPerNurseOnShift)
    : null;

  const perNurseDenom = x.shiftsPerYear * costPerNurseMinute * capture;
  let breakEvenMinutesPerShift: number | null;
  if (x.devicePriceUsd === 0) {
    breakEvenMinutesPerShift = 0;
  } else if (perNurseDenom > 0) {
    breakEvenMinutesPerShift = finiteOrNull(x.devicePriceUsd / perNurseDenom);
  } else {
    breakEvenMinutesPerShift = null;
  }

  return {
    costPerNurseMinute,
    valuePerNurseYear,
    valuePerDeviceYear: valuePerNurseYear,
    paybackMonthsPerDevice,
    paybackMonthsWithRunning,
    netValuePerDeviceYear,
    devicesPerUnit,
    devicesAllUnits,
    hospitalDevices,
    unitAnnualValue: finiteOrNull(valuePerNurseYear * devicesAllUnits),
    hospitalAnnualValue: hospitalDevices === null ? null : finiteOrNull(valuePerNurseYear * hospitalDevices),
    breakEvenMinutesPerShift,
  };
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function formatUsd(n: number | null): string {
  return n === null ? 'n/a' : usd0.format(n);
}

export function formatUsdCents(n: number): string {
  return usd2.format(n);
}

export function formatCount(n: number | null): string {
  return n === null ? 'n/a' : num0.format(n);
}

export function formatMinutes(n: number | null): string {
  return n === null ? 'n/a' : `${num1.format(n)} min`;
}

export function formatMonths(n: number | null): string {
  if (n === null) return 'n/a';
  if (n === 0) return '0 (free device)';
  return `${num1.format(n)} months`;
}
