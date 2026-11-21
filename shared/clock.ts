// Demo clock for Bedside Glance (FRD v2.2 section 5). Pure functions only:
// callers inject `nowMs`, so tests never read the wall clock.

/** Shift start in the demo: 1:42 PM, in minutes since midnight. */
export const DEMO_START_MIN = 822;

/** A med is actionable ("Due now") when it is due within this many minutes. */
export const ACTIONABLE_WINDOW_MIN = 30;

const MS_PER_MIN = 60_000;

/**
 * Current demo time in minutes since midnight. Runs 1:1 with real time from
 * `shiftStartedAtMs`. `offsetMin` is the Director's cumulative clock offset.
 * Times before the shift start clamp to DEMO_START_MIN.
 */
export function demoMinutes(shiftStartedAtMs: number, nowMs: number, offsetMin = 0): number {
  const elapsed = Math.max(0, Math.floor((nowMs - shiftStartedAtMs) / MS_PER_MIN));
  return DEMO_START_MIN + elapsed + offsetMin;
}

/** Minutes from `nowMin` until `dueMin` (both minutes since midnight). Negative when overdue. */
export function minutesUntil(dueMin: number, nowMin: number): number {
  return dueMin - nowMin;
}

/** True when a med is due within the actionable window (<= 30 minutes). */
export function isActionable(minutesUntilDue: number): boolean {
  return minutesUntilDue <= ACTIONABLE_WINDOW_MIN;
}

/** Parse a 24h "HH:MM" string into minutes since midnight. Throws on bad input. */
export function hhmmToMinutes(hhmm: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) throw new RangeError(`Invalid HH:MM time: ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function clock12(minOfDay: number): { h: number; m: string; suffix: 'AM' | 'PM' } {
  const total = ((Math.floor(minOfDay) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  return {
    h: hour24 % 12 === 0 ? 12 : hour24 % 12,
    m: String(total % 60).padStart(2, '0'),
    suffix: hour24 < 12 ? 'AM' : 'PM',
  };
}

/** Compact time for chips and hints: `11:00a`, `2:10p`. */
export function shortTime(minOfDay: number): string {
  const { h, m, suffix } = clock12(minOfDay);
  return `${h}:${m}${suffix === 'AM' ? 'a' : 'p'}`;
}

/** Full time for the wound and vitals lines: `9:00 AM`, `2:00 PM`. */
export function longTime(minOfDay: number): string {
  const { h, m, suffix } = clock12(minOfDay);
  return `${h}:${m} ${suffix}`;
}
