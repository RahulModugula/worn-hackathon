// Seeded fuzz of applyAction. Deterministic: every failure message carries `seed=<n>`; rerun one sequence with
// STRESS_SEED=<n> STRESS_RUNS=1 npx vitest run server/stress.fuzz.test.ts
import { describe, it, expect } from 'vitest'
import patientsJson from '../data/patients.json'
import { applyAction, newState, validateAction, UNDO_WINDOW_MS, MAX_FEED, MAX_WOUND_CAPTURES, type PatientsData } from './sessionStore'
import { TELEMETRY_KEEP, type Action, type ActionResult, type SessionState, type WoundCaptureStatus } from '../shared/types'

/** mulberry32: tiny deterministic PRNG, no dependency. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}

const real = patientsJson as unknown as PatientsData
/** Real roster plus one patient that exists but is NOT on the nurse's list. */
const PATIENTS: PatientsData = {
  nurse: real.nurse,
  patients: [...real.patients, { id: 'P-9999', name: 'Not Assigned', room: '99', attending: 'Dr. X', meds: [{ id: 'M-9', name: 'X', dueAt: '14:00' }] }],
}
const ASSIGNED = PATIENTS.nurse!.assignedPatientIds!
const PIDS = ['P-1012', 'P-1014', 'P-9999', 'ghost', '__proto__', 'constructor', 'toString']
const MEDS = ['M-1', 'M-2', 'M-3', 'M-4', 'M-9', 'X-1', 'nope', '__proto__']
const CAPS = ['c1', 'c2', 'c3', 'c4', '__proto__', 'constructor']
const DEVICES = ['glasses', 'phone', 'director'] as const
const RANK: Record<WoundCaptureStatus, number> = { captured: 0, pending_review: 1, saved: 2, sent: 3 }

const DIRECTOR_ONLY = (a: Action) =>
  a.type === 'RESET_SESSION' || a.type === 'SET_CLOCK_OFFSET' || a.type.startsWith('SIM_') || (a.type === 'START_SHIFT' && a.baseMin !== undefined)

function genRaw(r: ReturnType<typeof rng>, fresh: () => string): Record<string, unknown> {
  const device = r.pick(DEVICES)
  const base = { device, clientEventId: fresh() }
  const t = r.int(100)
  if (t < 22) return { ...base, type: 'LOG_MED', patientId: r.pick(PIDS), medKey: r.pick(MEDS), via: r.pick(['glasses', 'phone', 'voice', 'tap', undefined]), earlyConfirmed: r.chance(0.4) ? true : undefined, scanLocked: r.chance(0.3) ? true : undefined }
  if (t < 32) return { ...base, type: 'UNDO_LAST_MED' }
  if (t < 40) return { ...base, type: 'SET_ACTIVE_PATIENT', patientId: r.chance(0.1) ? null : r.pick(PIDS) }
  if (t < 44) return { ...base, type: 'START_SHIFT', baseMin: r.chance(0.5) ? r.int(1440) : undefined }
  if (t < 47) return { ...base, type: 'RESET_SESSION' }
  if (t < 50) return { ...base, type: 'SET_CLOCK_OFFSET', offsetMin: r.pick([0, 30, -30, 1440, 1441, NaN, Infinity, -0, 1e308]) }
  if (t < 58) return { ...base, type: 'WOUND_CAPTURED', captureId: r.pick(CAPS), patientId: r.pick(PIDS), photoUploadFailed: r.chance(0.2), finding: r.chance(0.5) ? 'f' : '', comparison: 'c', draftNote: 'n', assessmentSource: r.pick(['gemini', 'fallback', 'unavailable', undefined]), source: r.pick(['glasses', 'director', undefined]) }
  if (t < 63) return { ...base, type: 'WOUND_SAVE', captureId: r.pick(CAPS), draftNote: r.chance(0.5) ? 'edit' : undefined }
  if (t < 69) return { ...base, type: 'WOUND_SEND', captureId: r.pick(CAPS), draftNote: r.chance(0.3) ? 'edit' : undefined }
  if (t < 71) return { ...base, type: 'WOUND_RETRY_UPLOAD', captureId: r.pick(CAPS) }
  if (t < 75) return { ...base, type: 'DR_REPLY', captureId: r.chance(0.7) ? r.pick(CAPS) : undefined, from: 'Dr', text: 't' }
  if (t < 77) return { ...base, type: 'SEND_TO_PHONE', text: 'hi' }
  if (t < 79) return { ...base, type: 'SET_GLASSES_NOTICE', notice: r.chance(0.3) ? null : { text: 'n', kind: 'k' } }
  if (t < 81) return { ...base, type: 'SET_GLASSES_VIEW', view: { a: r.int(10) } }
  if (t < 87) return { ...base, type: 'TELEMETRY_SAMPLE', metric: r.pick(['scanToCardMs', 'doneToAckMs', 'assessMs', 'bogus']), ms: r.pick([1, 250.6, 0, -1, NaN, 1e9]) }
  if (t < 94) return { ...base, type: r.pick(['SIM_CLOCK_PLUS_30', 'SIM_ADD_CONFLICT_ORDER', 'SIM_VOICE_DONE', 'SIM_FAIL_PHOTO_UPLOAD', 'SIM_DR_REPLY', 'SIM_SCAN_RM_12']), payload: r.chance(0.5) ? { patientId: r.pick(PIDS) } : undefined }
  // junk: unknown/malformed
  return r.pick<Record<string, unknown>>([
    { ...base, type: 'DROP_TABLES' }, { ...base, type: 42 }, { ...base, type: '__proto__' }, { device, type: 'LOG_MED' },
    { ...base, type: 'LOG_MED', patientId: 7, medKey: {} }, { ...base, device: 'admin', type: 'UNDO_LAST_MED' },
    { ...base, type: 'SET_ACTIVE_PATIENT', patientId: ['P-1012'] }, { ...base, type: 'WOUND_SAVE', captureId: '../etc' },
    { ...base, type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'carrier-pigeon' },
    { ...base, type: 'SET_GLASSES_VIEW', view: { deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } } },
    { ...base, type: 'SIM_ADD_CONFLICT_ORDER', payload: { __proto__: { polluted: 1 }, patientId: 'P-1012' } },
    JSON.parse('{"clientEventId":"j1","device":"phone","type":"SIM_VOICE_DONE","payload":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}}'),
  ])
}

class Violation extends Error {}
const need = (cond: unknown, msg: string): void => { if (!cond) throw new Violation(msg) }

function runSequence(seed: number, steps: number): void {
  const r = rng(seed)
  const withPatients = !r.chance(0.1)
  const patients = withPatients ? PATIENTS : undefined
  const s: SessionState = newState('fuzz')
  let now = 1_000_000_000 + r.int(1_000_000)
  let counter = 0
  const fresh = () => `e${seed}-${++counter}`
  /** Model of what the store must believe. */
  const given = new Map<string, { atMs: number; by: string }>()
  let lastLog: { key: string; atMs: number } | null = null
  const history: { device: string; id: string; action: Record<string, unknown>; ok: boolean; message?: string; conflict?: boolean }[] = []
  let prevSeq = 0
  const prevWound = new Map<string, number>()
  const protoKeys = Object.getOwnPropertyNames(Object.prototype).length

  for (let step = 0; step < steps; step++) {
    now += r.pick([0, 0, 1, 50, 500, 3000, 9_999, 10_000, 10_001, 15_000])
    let raw: Record<string, unknown>
        if (history.length > 0 && r.chance(0.15)) {
      // duplicate: same device+clientEventId, same body (retry) or a different body (id collision)
      const h = history[history.length - 1 - r.int(Math.min(history.length, 120))]
      raw = r.chance(0.5) ? h.action : { ...genRaw(r, fresh), device: h.device, clientEventId: h.id }
    } else raw = genRaw(r, fresh)

    const wire = (() => { try { return JSON.parse(JSON.stringify(raw)) } catch { return null } })()
    const vv = validateAction(wire)
    if ('error' in vv) { need(typeof vv.error === 'string', 'error must be string'); continue }
    const action = vv.action
    if (DIRECTOR_ONLY(action) && action.device !== 'director') continue // refused by index.ts before applyAction

    const dupCandidate = history.some(h => h.device === action.device && h.id === action.clientEventId)
    const before = dupCandidate ? JSON.stringify(s) : ''
    const seqBefore = s.eventSeq
    let res: ActionResult
    try { res = applyAction(s, action, now, patients) } catch (e) { throw new Violation(`applyAction threw: ${(e as Error).message}`) }
    const dupOf = history.find(h => h.device === action.device && h.id === action.clientEventId)

    if (dupOf) {
      need(JSON.stringify(s) === before, `duplicate ${action.device}:${action.clientEventId} changed state`)
      need(res.ok === dupOf.ok && res.message === dupOf.message && res.conflict === dupOf.conflict, 'duplicate returned a different result')
      continue
    }
    history.push({ device: action.device, id: action.clientEventId, action: wire, ok: res.ok, message: res.message, conflict: res.conflict })
    if (history.length > 150) history.shift() // the replay cache holds 200; stay well inside it

    // ---- model update, with expectations checked against the real result ----
    switch (action.type) {
      case 'LOG_MED': {
        const key = `${action.patientId}:${action.medKey}`
        if (res.ok) {
          need(!given.has(key), `LOG_MED accepted twice for ${key} (first writer must win)`)
          given.set(key, { atMs: now, by: action.device })
          lastLog = { key, atMs: now }
        } else if (given.has(key)) need(res.conflict === true, `second LOG_MED for ${key} must be a conflict`)
        break
      }
      case 'UNDO_LAST_MED': {
        const expectOk = lastLog !== null && now - lastLog.atMs <= UNDO_WINDOW_MS
        need(res.ok === expectOk, `undo ok=${res.ok} expected ${expectOk} (age ${lastLog ? now - lastLog.atMs : 'n/a'})`)
        if (res.ok) { given.delete(lastLog!.key); lastLog = null }
        break
      }
      case 'RESET_SESSION':
        need(res.ok === true, 'RESET must succeed')
        given.clear(); lastLog = null; prevWound.clear()
        need(s.shift === null && s.clock === null && s.clockOffsetMin === 0 && s.activePatientId === null, 'RESET left shift/clock/offset/active')
        need(Object.keys(s.medStatus).length === 0 && s.woundCaptures.length === 0 && s.glassesNotice === null, 'RESET left meds/wounds/notice')
        need(s.events.length === 0 && s.lastMedLog === null && s.glassesViewState === null && s.photoUploadShouldFail === false, 'RESET left events/lastMedLog/view/photoFail')
        need(!('telemetry' in s) && !('feed' in s) && !('extraOrders' in s), 'RESET left an optional key (telemetry/feed/extraOrders)')
        break
    }

    // ---- invariants after EVERY step ----
    need(s.eventSeq >= seqBefore && s.eventSeq - seqBefore <= 1, `eventSeq not monotonic (${seqBefore} -> ${s.eventSeq})`)
    need(s.eventSeq >= prevSeq, 'eventSeq went backwards'); prevSeq = s.eventSeq
    const givenKeys = Object.keys(s.medStatus).filter(k => s.medStatus[k].status === 'given')
    need(givenKeys.length === given.size, `given records ${givenKeys.length} != model ${given.size}`)
    for (const [k, m] of given) {
      const st = s.medStatus[k]
      need(st?.status === 'given' && st.givenAtMs === m.atMs && st.by === m.by, `first writer lost for ${k}`)
    }
    need(s.lastMedLog === null ? lastLog === null : lastLog !== null && s.lastMedLog.key === lastLog.key && s.lastMedLog.acceptedAtMs === lastLog.atMs, 'lastMedLog diverged from model')
    need(s.events.length <= 200, 'events exceeded cap')
    need((s.feed?.length ?? 0) <= MAX_FEED, 'feed exceeded cap')
    need(s.woundCaptures.length <= MAX_WOUND_CAPTURES, 'woundCaptures exceeded cap')
    for (const arr of Object.values(s.telemetry ?? {})) need((arr as number[]).length <= TELEMETRY_KEEP, 'telemetry exceeded cap')
    if (withPatients && s.activePatientId !== null) need(ASSIGNED.includes(s.activePatientId), `unassigned patient ${s.activePatientId} became active`)
    for (const c of s.woundCaptures) {
      const rk = RANK[c.status]
      need(rk !== undefined, 'bad wound status')
      const was = prevWound.get(c.captureId)
      need(was === undefined || rk >= was, `wound ${c.captureId} moved backwards ${was} -> ${rk}`)
      prevWound.set(c.captureId, rk)
    }
    for (const id of [...prevWound.keys()]) if (!s.woundCaptures.some(c => c.captureId === id)) prevWound.delete(id) // evicted
    // JSON-serialisable: stringify must not throw and must be stable through a round trip.
    const js = JSON.stringify(s)
    if (step % 4 === 0 || step === steps - 1) need(JSON.stringify(JSON.parse(js)) === js, 'state is not stable through JSON')
    need(!/NaN|Infinity/.test(js.replace(/"[^"]*"/g, '')), 'non-finite number in state')
    // Prototype pollution.
    need(({} as Record<string, unknown>).polluted === undefined, 'Object.prototype polluted')
    need(Object.getOwnPropertyNames(Object.prototype).length === protoKeys, 'Object.prototype gained a key')
    need(Object.getPrototypeOf(s.medStatus) === Object.prototype, 'medStatus prototype replaced')
  }
}

const SEED0 = Number(process.env.STRESS_SEED ?? 0xc0ffee)
const RUNS = Number(process.env.STRESS_RUNS ?? 20_000)

function guarded(seed: number, steps: number) {
  try { runSequence(seed, steps) } catch (e) {
    throw new Error(`seed=${seed} steps=${steps}: ${(e as Error).message}`)
  }
}

describe('applyAction seeded fuzz', () => {
  it(`${RUNS} random sequences keep every invariant`, () => {
    for (let i = 0; i < RUNS; i++) guarded(SEED0 + i, 8 + (i % 9))
  }, 60_000)
  it('long sequences hit and respect the caps (events 200, feed 60, wounds 20, telemetry 20)', () => {
    for (let i = 0; i < 20; i++) guarded(SEED0 + 1_000_000 + i, 1500)
  }, 60_000)
  it('is deterministic: the same seed produces the same final state', () => {
    const run = (seed: number) => {
      const r = rng(seed); return Array.from({ length: 5 }, () => r.int(1000)).join(',')
    }
    expect(run(7)).toBe(run(7))
    expect(run(7)).not.toBe(run(8))
  })
})

// Regression: findMed must not walk the prototype chain when there is no roster (patients.json failed to load).
describe('prototype-named ids (regression)', () => {
  it('LOG_MED for patientId "__proto__" after SIM_ADD_CONFLICT_ORDER does not throw without a roster', () => {
    const s = newState('p')
    applyAction(s, { type: 'SIM_ADD_CONFLICT_ORDER', device: 'director', clientEventId: 'a', payload: { patientId: 'P-1012' } }, 1000)
    expect(() => applyAction(s, { type: 'LOG_MED', device: 'phone', clientEventId: 'b', patientId: '__proto__', medKey: 'X-1' }, 1000)).not.toThrow()
    expect(Object.getOwnPropertyNames(Object.prototype).includes('polluted')).toBe(false)
  })
})
