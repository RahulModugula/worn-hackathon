import { describe, it, expect } from 'vitest'

describe('scripts/export-telemetry.mjs', () => {
  it('prints a markdown table with p50 and max, and NOT MEASURED for empty metrics', async () => {
    const mod: { toMarkdown: (j: unknown, stamp?: string) => string } = await import('../scripts/export-telemetry.mjs' as string)
    const md = mod.toMarkdown({ session: 'demo', telemetry: { scanToCardMs: [900, 400, 1200], doneToAckMs: [80, 120] } }, '2026-11-21T12:00:00Z')
    expect(md).toContain('| Metric | n | p50 (ms) | max (ms) |')
    expect(md).toContain('| Scan lock to Meds card (G4 render) | 3 | 900 | 1200 |')
    expect(md).toContain('| "done" (LOG_MED) to server ack | 2 | 80 | 120 |')
    expect(md).toContain('| Wound assessment (assess call) | 0 | NOT MEASURED | NOT MEASURED |')
  })
})
