// Latency telemetry helpers (kill-gate, FRD v2.2 section 4). Pure.
import type { TelemetryMetric } from './types'

export const METRIC_LABEL: Record<TelemetryMetric, string> = {
  scanToCardMs: 'Scan lock to Meds card (G4 render)',
  doneToAckMs: '"done" (LOG_MED) to server ack',
  assessMs: 'Wound assessment (assess call)',
  outboxQueuedMs: 'Offline action queued to flushed (outbox)',
}

/** Median of the samples (lower middle for an even count, so it is always a measured value). Null when empty. */
export function p50(xs: readonly number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

export function maxOf(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : Math.max(...xs)
}

/** "Chrome/119.0.6045.163" -> "119.0.6045.163". Null when the user agent has no Chrome token (e.g. iOS Safari). */
export function chromeVersion(ua: string): string | null {
  const m = /(?:Chrome|CriOS)\/(\d+(?:\.\d+){0,3})/.exec(ua)
  return m ? m[1] : null
}
