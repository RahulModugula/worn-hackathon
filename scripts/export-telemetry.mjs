#!/usr/bin/env node
// Prints the session's latency telemetry as a markdown table for docs/decisions/kill-gate.md.
// Usage: node scripts/export-telemetry.mjs [--url http://localhost:3001] [--session demo]
// Reads GET /api/telemetry?session=... (the last 20 samples per metric, sent by the glasses).
import { pathToFileURL } from 'node:url'

export const LABELS = {
  scanToCardMs: 'Scan lock to Meds card (G4 render)',
  doneToAckMs: '"done" (LOG_MED) to server ack',
  assessMs: 'Wound assessment (assess call)',
  outboxQueuedMs: 'Offline action queued to flushed (outbox)',
}

const p50 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)] }

/** @param {{session?: string, telemetry?: Record<string, number[]>}} json  @param {string} [stamp] */
export function toMarkdown(json, stamp = new Date().toISOString()) {
  const t = json?.telemetry ?? {}
  const lines = [
    `Telemetry for session \`${json?.session ?? 'demo'}\`, read ${stamp} (last 20 samples per metric, reported by the glasses).`,
    '',
    '| Metric | n | p50 (ms) | max (ms) |',
    '|---|---|---|---|',
  ]
  for (const [key, label] of Object.entries(LABELS)) {
    const xs = Array.isArray(t[key]) ? t[key].filter((x) => Number.isFinite(x)) : []
    lines.push(xs.length ? `| ${label} | ${xs.length} | ${p50(xs)} | ${Math.max(...xs)} |` : `| ${label} | 0 | NOT MEASURED | NOT MEASURED |`)
  }
  return lines.join('\n')
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function main() {
  const base = arg('url', process.env.TELEMETRY_URL || 'http://localhost:3001').replace(/\/$/, '')
  const session = arg('session', 'demo')
  const res = await fetch(`${base}/api/telemetry?session=${encodeURIComponent(session)}`)
  if (!res.ok) throw new Error(`GET /api/telemetry failed: HTTP ${res.status}`)
  console.log(toMarkdown(await res.json()))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1) })
}
