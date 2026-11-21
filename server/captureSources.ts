import type { AssessmentSource } from '../shared/types.js'

const MAX = 200
/** captureId -> the source the SERVER produced at /api/assess-wound. Insertion-ordered, oldest evicted first. */
const sources = new Map<string, AssessmentSource>()

export function recordAssessmentSource(captureId: string, source: AssessmentSource): void {
  sources.delete(captureId)
  sources.set(captureId, source)
  while (sources.size > MAX) sources.delete(sources.keys().next().value as string)
}

/**
 * The source to store for a WOUND_CAPTURED. The server's own record wins; with no record (a client-side
 * fallback, a director sim) a claim of 'gemini' is downgraded to 'fallback' so a forged claim can never
 * show as "AI result".
 */
export function resolveAssessmentSource(captureId: string, claimed: AssessmentSource | undefined): AssessmentSource | undefined {
  const recorded = sources.get(captureId)
  if (recorded) return recorded
  return claimed === 'gemini' ? 'fallback' : claimed
}
