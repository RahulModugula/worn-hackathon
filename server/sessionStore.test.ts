import { describe, it, expect, beforeEach } from 'vitest'
import { applyAction, newState, validateAction, type PatientsData } from './sessionStore'
import type { Action, SessionState } from '../shared/types'

const patients: PatientsData = { patients: [{ id: 'p1', meds: [{ id: 'met' }, { id: 'asp' }] }] }
let n = 0
const id = () => `e${++n}`
const log = (device: 'glasses' | 'phone', medKey = 'met'): Action =>
  ({ type: 'LOG_MED', patientId: 'p1', medKey, device, clientEventId: id() })
let s: SessionState
const T0 = 1_000_000

beforeEach(() => { s = newState('t') })

describe('LOG_MED first-write-wins', () => {
  it('concurrent glasses+phone: exactly one ok, loser gets exact message', () => {
    applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id() }, T0, patients)
    const a = applyAction(s, log('glasses'), T0 + 100, patients)
    const b = applyAction(s, log('phone'), T0 + 100, patients)
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(a.ok).toBe(true)
    expect(b.conflict).toBe(true)
    expect(b.message).toBe('Already given 1:42 PM via glasses')
    expect(b.state.medStatus['p1:met'].status).toBe('given')
  })
  it('rejects unknown med', () => {
    expect(applyAction(s, log('phone', 'nope'), T0, patients).ok).toBe(false)
  })
})

describe('UNDO_LAST_MED 10s window', () => {
  const undo = (device: 'glasses' | 'phone'): Action => ({ type: 'UNDO_LAST_MED', device, clientEventId: id() })
  it('succeeds at 9,999ms from either device and reverts to due', () => {
    applyAction(s, log('glasses'), T0, patients)
    const r = applyAction(s, undo('phone'), T0 + 9_999, patients)
    expect(r.ok).toBe(true)
    expect(r.state.medStatus['p1:met'].status).toBe('due')
  })
  it('fails at 10,001ms and state unchanged', () => {
    applyAction(s, log('glasses'), T0, patients)
    const r = applyAction(s, undo('glasses'), T0 + 10_001, patients)
    expect(r.ok).toBe(false)
    expect(r.state.medStatus['p1:met'].status).toBe('given')
  })
})

describe('idempotency', () => {
  it('duplicate clientEventId returns original result, state unchanged', () => {
    const a = log('glasses')
    const r1 = applyAction(s, a, T0, patients)
    const v = s.version
    const r2 = applyAction(s, a, T0 + 5, patients)
    expect(r2.ok).toBe(r1.ok)
    expect(s.version).toBe(v)
    expect(s.events).toHaveLength(1)
  })
  it('replay of a conflict stays a conflict', () => {
    applyAction(s, log('glasses'), T0, patients)
    const b = log('phone')
    expect(applyAction(s, b, T0, patients).conflict).toBe(true)
    expect(applyAction(s, b, T0, patients).conflict).toBe(true)
  })
})

describe('RESET_SESSION and clock offset', () => {
  it('clears every field and tells client to clear outbox', () => {
    applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id() }, T0, patients)
    applyAction(s, { type: 'SET_ACTIVE_PATIENT', patientId: 'p1', device: 'phone', clientEventId: id() }, T0, patients)
    applyAction(s, log('glasses'), T0, patients)
    applyAction(s, { type: 'WOUND_CAPTURED', captureId: 'c1', patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'd', device: 'glasses', clientEventId: id() }, T0, patients)
    applyAction(s, { type: 'SEND_TO_PHONE', text: 'x', device: 'glasses', clientEventId: id() }, T0, patients)
    applyAction(s, { type: 'SIM_CLOCK_PLUS_30', device: 'director', clientEventId: id() }, T0, patients)
    expect(s.clockOffsetMin).toBe(30)
    const r = applyAction(s, { type: 'RESET_SESSION', device: 'director', clientEventId: id() }, T0, patients)
    expect(r.clearOutbox).toBe(true)
    const st = r.state
    expect(st.shift).toBeNull()
    expect(st.clock).toBeNull()
    expect(st.clockOffsetMin).toBe(0)
    expect(st.activePatientId).toBeNull()
    expect(st.medStatus).toEqual({})
    expect(st.woundCaptures).toEqual([])
    expect(st.glassesNotice).toBeNull()
    expect(st.events).toEqual([])
    expect(st.lastMedLog).toBeNull()
  })
  it('SET_CLOCK_OFFSET sets offset', () => {
    expect(applyAction(s, { type: 'SET_CLOCK_OFFSET', offsetMin: 45, device: 'director', clientEventId: id() }, T0).state.clockOffsetMin).toBe(45)
  })
})

describe('validateAction', () => {
  it('rejects junk and unknown types', () => {
    expect('error' in validateAction(null)).toBe(true)
    expect('error' in validateAction({ type: 'HACK', clientEventId: 'a', device: 'phone' })).toBe(true)
    expect('error' in validateAction({ type: 'LOG_MED', clientEventId: 'a', device: 'phone' })).toBe(true)
    expect('action' in validateAction({ type: 'UNDO_LAST_MED', clientEventId: 'a', device: 'phone' })).toBe(true)
  })
})

// ---------- wound lifecycle, seq cursor, assignment, photo-fail toggle ----------
const woundPatients: PatientsData = {
  nurse: { assignedPatientIds: ['p1'] },
  patients: [{ id: 'p1', attending: 'Dr. Okafor', meds: [{ id: 'met' }] }, { id: 'p9', meds: [] }],
}
const captured = (over: Record<string, unknown> = {}): Action => ({
  type: 'WOUND_CAPTURED', captureId: 'cap-1', patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'd',
  device: 'glasses', clientEventId: id(), ...over,
} as Action)
const wound = (type: 'WOUND_SAVE' | 'WOUND_SEND' | 'WOUND_RETRY_UPLOAD', over: Record<string, unknown> = {}): Action =>
  ({ type, captureId: 'cap-1', device: 'phone', clientEventId: id(), ...over } as Action)

describe('wound lifecycle', () => {
  it('WOUND_CAPTURED with an assessment lands as pending_review with every field', () => {
    const r = applyAction(s, captured({ source: 'director' }), T0, woundPatients)
    expect(r.ok).toBe(true)
    expect(r.state.woundCaptures).toEqual([{
      captureId: 'cap-1', patientId: 'p1', status: 'pending_review', photoUploadFailed: false,
      finding: 'f', comparison: 'c', draftNote: 'd', source: 'director', capturedAtMs: T0,
    }])
  })
  it('failed upload is captured (no assessment); RETRY keeps the same captureId and clears the flag; assessment then promotes it', () => {
    applyAction(s, captured({ photoUploadFailed: true, finding: '', comparison: '', draftNote: '' }), T0, woundPatients)
    expect(s.woundCaptures[0]).toMatchObject({ status: 'captured', photoUploadFailed: true })
    expect(applyAction(s, wound('WOUND_RETRY_UPLOAD'), T0 + 1, woundPatients).ok).toBe(true)
    expect(s.woundCaptures[0].photoUploadFailed).toBe(false)
    applyAction(s, captured(), T0 + 2, woundPatients)
    expect(s.woundCaptures).toHaveLength(1)
    expect(s.woundCaptures[0]).toMatchObject({ captureId: 'cap-1', status: 'pending_review', capturedAtMs: T0 })
  })
  it('a fallback (no AI review) capture is stored non-clinical whatever text the client sent', () => {
    applyAction(s, captured({ assessmentSource: 'fallback', finding: 'Incision edges closed. No redness.', comparison: 'Healing well', draftNote: 'Dressing intact, no drainage.' }), T0, woundPatients)
    const c = s.woundCaptures[0]
    expect(c.assessmentSource).toBe('fallback')
    expect(`${c.finding} ${c.comparison} ${c.draftNote}`).not.toMatch(/incision|redness|healing|drainage|intact/i)
    expect(c.finding).toBe('Photo saved. No AI review.')
    expect(c.draftNote).toBe('Wound photo taken. Nurse assessment:')
  })
  it('RETRY on an unknown capture fails', () => {
    expect(applyAction(s, wound('WOUND_RETRY_UPLOAD', { captureId: 'nope' }), T0, woundPatients).ok).toBe(false)
  })
  it('SAVE then SEND; draft edit is kept; SEND adds the glasses notice with the attending', () => {
    applyAction(s, captured(), T0, woundPatients)
    expect(applyAction(s, wound('WOUND_SAVE', { draftNote: 'edited' }), T0 + 1, woundPatients).ok).toBe(true)
    expect(s.woundCaptures[0]).toMatchObject({ status: 'saved', draftNote: 'edited' })
    const r = applyAction(s, wound('WOUND_SEND'), T0 + 2, woundPatients)
    expect(r.ok).toBe(true)
    expect(r.state.woundCaptures[0]).toMatchObject({ status: 'sent', sentTo: 'Dr. Okafor' })
    expect(r.state.glassesNotice).toEqual({ text: 'Sent to Dr. Okafor', kind: 'sent', atMs: T0 + 2 })
  })
  it('FWW: a second SEND (new clientEventId) is a conflict, no second notice and no version bump', () => {
    applyAction(s, captured(), T0, woundPatients)
    applyAction(s, wound('WOUND_SEND'), T0 + 1, woundPatients)
    const v = s.version
    const again = applyAction(s, wound('WOUND_SEND'), T0 + 500, woundPatients)
    expect(again).toMatchObject({ ok: false, conflict: true, message: 'Already sent to Dr. Okafor' })
    expect(s.version).toBe(v)
    expect(s.glassesNotice!.atMs).toBe(T0 + 1)
  })
  it('a replayed SEND (same clientEventId) returns the original result and sends once', () => {
    applyAction(s, captured(), T0, woundPatients)
    const send = wound('WOUND_SEND')
    const r1 = applyAction(s, send, T0 + 1, woundPatients)
    const r2 = applyAction(s, send, T0 + 9000, woundPatients)
    expect(r2.ok).toBe(r1.ok)
    expect(s.glassesNotice!.atMs).toBe(T0 + 1)
    expect(s.events.filter(e => e.type === 'WOUND_SEND')).toHaveLength(1)
  })
  it('late WOUND_CAPTURED / SAVE after sent cannot rewrite or downgrade the record', () => {
    applyAction(s, captured(), T0, woundPatients)
    applyAction(s, wound('WOUND_SEND'), T0 + 1, woundPatients)
    expect(applyAction(s, captured({ draftNote: 'changed' }), T0 + 2, woundPatients).conflict).toBe(true)
    expect(applyAction(s, wound('WOUND_SAVE'), T0 + 3, woundPatients).conflict).toBe(true)
    expect(s.woundCaptures[0]).toMatchObject({ status: 'sent', draftNote: 'd' })
  })
  it('cannot SAVE or SEND a capture that has no assessment yet', () => {
    applyAction(s, captured({ photoUploadFailed: true, finding: '', comparison: '', draftNote: '' }), T0, woundPatients)
    expect(applyAction(s, wound('WOUND_SEND'), T0, woundPatients).ok).toBe(false)
    expect(applyAction(s, wound('WOUND_SAVE'), T0, woundPatients).ok).toBe(false)
    expect(s.glassesNotice).toBeNull()
  })
  it('DR_REPLY adds the reply to the capture and a G9 notice; a second reply is a conflict', () => {
    applyAction(s, captured(), T0, woundPatients)
    applyAction(s, wound('WOUND_SEND'), T0 + 1, woundPatients)
    const dr = (): Action => ({ type: 'DR_REPLY', captureId: 'cap-1', from: 'Dr. Okafor', text: 'Looks good', device: 'director', clientEventId: id() })
    const r = applyAction(s, dr(), T0 + 5000, woundPatients)
    expect(r.ok).toBe(true)
    expect(r.state.woundCaptures[0].reply).toEqual({ from: 'Dr. Okafor', text: 'Looks good', atMs: T0 + 5000 })
    expect(r.state.glassesNotice).toMatchObject({ text: 'Dr. Okafor: Looks good', kind: 'dr_reply' })
    expect(applyAction(s, dr(), T0 + 6000, woundPatients).conflict).toBe(true)
  })
  it('unknown patient is rejected', () => {
    expect(applyAction(s, captured({ patientId: 'zzz' }), T0, woundPatients).ok).toBe(false)
  })
  it('RESET_SESSION clears wound captures', () => {
    applyAction(s, captured(), T0, woundPatients)
    applyAction(s, { type: 'RESET_SESSION', device: 'director', clientEventId: id() }, T0, woundPatients)
    expect(s.woundCaptures).toEqual([])
  })
})

describe('validateAction wound actions', () => {
  const base = { clientEventId: 'a', device: 'glasses' }
  it('requires a safe captureId and string fields', () => {
    expect('error' in validateAction({ ...base, type: 'WOUND_SEND', captureId: '../x' })).toBe(true)
    expect('error' in validateAction({ ...base, type: 'WOUND_SEND' })).toBe(true)
    expect('action' in validateAction({ ...base, type: 'WOUND_SEND', captureId: 'cap-1' })).toBe(true)
    expect('error' in validateAction({ ...base, type: 'WOUND_CAPTURED', captureId: 'c', patientId: 'p', finding: 1, comparison: '', draftNote: '' })).toBe(true)
    expect('error' in validateAction({ ...base, type: 'WOUND_CAPTURED', captureId: 'c', patientId: 'p', finding: 'x'.repeat(2001), comparison: '', draftNote: '' })).toBe(true)
    expect('error' in validateAction({ ...base, type: 'DR_REPLY', from: 'x' })).toBe(true)
  })
})

describe('event seq cursor', () => {
  it('every recorded event gets the next seq and eventSeq tracks the newest', () => {
    applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id() }, T0)
    applyAction(s, { type: 'SIM_VOICE_DONE', device: 'director', clientEventId: id() }, T0)
    expect(s.events.map(e => e.seq)).toEqual([1, 2])
    expect(s.eventSeq).toBe(2)
  })
  it('failed actions and replays do not consume a seq', () => {
    const bad = log('phone', 'nope')
    applyAction(s, bad, T0, patients)
    applyAction(s, bad, T0, patients)
    expect(s.eventSeq).toBe(0)
  })
  it('seq is monotonic across RESET_SESSION (a client cursor never goes backwards into new events)', () => {
    applyAction(s, { type: 'SIM_VOICE_DONE', device: 'director', clientEventId: id() }, T0)
    applyAction(s, { type: 'RESET_SESSION', device: 'director', clientEventId: id() }, T0)
    expect(s.events).toEqual([])
    expect(s.eventSeq).toBe(1)
    applyAction(s, { type: 'SIM_VOICE_DONE', device: 'director', clientEventId: id() }, T0)
    expect(s.events[0].seq).toBe(2)
  })
})

describe('SIM_FAIL_PHOTO_UPLOAD toggles', () => {
  it('true, then false, then true', () => {
    const t = () => applyAction(s, { type: 'SIM_FAIL_PHOTO_UPLOAD', device: 'director', clientEventId: id() }, T0).state.photoUploadShouldFail
    expect([t(), t(), t()]).toEqual([true, false, true])
  })
})

describe('assignment safety', () => {
  const setActive = (patientId: string | null): Action => ({ type: 'SET_ACTIVE_PATIENT', patientId, device: 'glasses', clientEventId: id() })
  it('a patient not on the nurse list is refused with "Not on your list" and activePatientId stays', () => {
    applyAction(s, setActive('p1'), T0, woundPatients)
    const r = applyAction(s, setActive('p9'), T0, woundPatients)
    expect(r).toMatchObject({ ok: false, message: 'Not on your list' })
    expect(s.activePatientId).toBe('p1')
    expect(applyAction(s, setActive('ghost'), T0, woundPatients).ok).toBe(false)
  })
  it('clearing the active patient is always allowed', () => {
    applyAction(s, setActive('p1'), T0, woundPatients)
    expect(applyAction(s, setActive(null), T0, woundPatients).ok).toBe(true)
    expect(s.activePatientId).toBeNull()
  })
})

describe('validateAction bounds (adversarial review)', () => {
  const base = { clientEventId: 'v1', device: 'phone' }
  const bad = (o: object) => 'error' in validateAction({ ...base, ...o })
  const good = (o: object) => !('error' in validateAction({ ...base, ...o }))

  it('START_SHIFT.baseMin must be a finite integer 0..1439', () => {
    for (const baseMin of ['abc', NaN, Infinity, -1, 1440, 12.5, null, {}]) expect(bad({ type: 'START_SHIFT', baseMin }), String(baseMin)).toBe(true)
    expect(good({ type: 'START_SHIFT' })).toBe(true)
    expect(good({ type: 'START_SHIFT', baseMin: 0 })).toBe(true)
    expect(good({ type: 'START_SHIFT', baseMin: 1439 })).toBe(true)
  })
  it('SET_CLOCK_OFFSET must be finite within +-1440', () => {
    for (const offsetMin of [1e308, -1e308, NaN, Infinity, 1441, -1441, '5']) expect(bad({ type: 'SET_CLOCK_OFFSET', offsetMin }), String(offsetMin)).toBe(true)
    expect(good({ type: 'SET_CLOCK_OFFSET', offsetMin: -1440 })).toBe(true)
    expect(good({ type: 'SET_CLOCK_OFFSET', offsetMin: 30 })).toBe(true)
  })
  it('SET_GLASSES_NOTICE text must be a string of at most 200 chars', () => {
    expect(bad({ type: 'SET_GLASSES_NOTICE', notice: { text: { a: 1 } } })).toBe(true)
    expect(bad({ type: 'SET_GLASSES_NOTICE', notice: { text: 'x'.repeat(201) } })).toBe(true)
    expect(bad({ type: 'SET_GLASSES_NOTICE', notice: { text: 'ok', kind: 5 } })).toBe(true)
    expect(bad({ type: 'SET_GLASSES_NOTICE', notice: 'hi' })).toBe(true)
    expect(bad({ type: 'SET_GLASSES_NOTICE' })).toBe(true)
    expect(good({ type: 'SET_GLASSES_NOTICE', notice: null })).toBe(true)
    expect(good({ type: 'SET_GLASSES_NOTICE', notice: { text: 'x'.repeat(200) } })).toBe(true)
  })
  it('SET_GLASSES_VIEW and SIM payloads are size bounded', () => {
    expect(bad({ type: 'SET_GLASSES_VIEW', view: { big: 'x'.repeat(10_000) } })).toBe(true)
    expect(good({ type: 'SET_GLASSES_VIEW', view: { v: 1, screen: 'G1' } })).toBe(true)
    expect(bad({ type: 'SIM_VOICE_DONE', payload: 'x'.repeat(10_000) })).toBe(true)
  })
  it('rejects non-finite numbers anywhere (deep) and optional via/source of the wrong type', () => {
    expect(bad({ type: 'SET_GLASSES_VIEW', view: { n: 1e999 } })).toBe(true)
    expect(bad({ type: 'LOG_MED', patientId: 'p', medKey: 'm', via: 'telepathy' })).toBe(true)
    expect(good({ type: 'LOG_MED', patientId: 'p', medKey: 'm', via: 'voice' })).toBe(true)
  })
})

describe('WOUND_CAPTURED assessmentSource', () => {
  it('is validated and stored on the capture', () => {
    const base = { type: 'WOUND_CAPTURED', clientEventId: 'ws1', device: 'glasses', captureId: 'c1', patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'd' }
    expect('error' in validateAction({ ...base, assessmentSource: 'telepathy' })).toBe(true)
    const v = validateAction({ ...base, assessmentSource: 'fallback' })
    expect('action' in v).toBe(true)
    const st = newState('ws')
    applyAction(st, (v as { action: Action }).action, 1, patients)
    expect(st.woundCaptures[0].assessmentSource).toBe('fallback')
  })
})

// ---- Wave 2A contract ----
describe('LOG_MED early dose needs confirmation', () => {
  const pts: PatientsData = {
    patients: [{ id: 'p1', name: 'Maria Lopez', room: '12', meds: [
      { id: 'met', name: 'Metformin', dueAt: '14:00' }, { id: 'lis', name: 'Lisinopril', dueAt: '18:00' },
    ] }],
  }
  const start = () => applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id() }, T0, pts) // 1:42 PM
  it('rejects a med due in more than 30 min with needsConfirm, changes nothing', () => {
    start()
    const r = applyAction(s, log('phone', 'lis'), T0 + 1000, pts)
    expect(r.ok).toBe(false)
    expect(r.needsConfirm).toBe(true)
    expect(r.message).toBe('Not due until 6:00 PM')
    expect(r.state.medStatus['p1:lis']).toBeUndefined()
  })
  it('accepts an actionable med and an early one when earlyConfirmed', () => {
    start()
    expect(applyAction(s, log('phone', 'met'), T0 + 1000, pts).ok).toBe(true)
    const r = applyAction(s, { ...log('phone', 'lis'), earlyConfirmed: true } as Action, T0 + 1000, pts)
    expect(r.ok).toBe(true)
  })
  it('boundary: exactly 30 min away is actionable', () => {
    applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id(), baseMin: 1050 }, T0, pts) // 5:30 PM
    expect(applyAction(s, log('phone', 'lis'), T0, pts).ok).toBe(true)
  })
})

describe('TELEMETRY_SAMPLE', () => {
  const sample = (ms: number, metric: 'scanToCardMs' | 'doneToAckMs' | 'assessMs' = 'scanToCardMs'): Action =>
    ({ type: 'TELEMETRY_SAMPLE', metric, ms, device: 'glasses', clientEventId: id() })
  it('keeps the last 20 per metric and is not a feed event', () => {
    for (let i = 0; i < 25; i++) applyAction(s, sample(i), T0 + i, patients)
    expect(s.telemetry?.scanToCardMs).toHaveLength(20)
    expect(s.telemetry?.scanToCardMs?.[0]).toBe(5)
    expect(s.events.some(e => e.type === 'TELEMETRY_SAMPLE')).toBe(false)
  })
  it('validates metric and ms', () => {
    expect('error' in validateAction({ ...sample(1), metric: 'x' })).toBe(true)
    expect('error' in validateAction({ ...sample(1), ms: -1 })).toBe(true)
    expect('error' in validateAction({ ...sample(1), ms: Infinity })).toBe(true)
    expect('error' in validateAction(sample(120))).toBe(false)
  })
  it('RESET_SESSION clears it', () => {
    applyAction(s, sample(5), T0, patients)
    applyAction(s, { type: 'RESET_SESSION', device: 'director', clientEventId: id() }, T0, patients)
    expect(s.telemetry).toBeUndefined()
  })
})

describe('event bus and activity feed', () => {
  const pts: PatientsData = { patients: [{ id: 'p1', name: 'Maria Lopez', room: '12', meds: [{ id: 'met', name: 'Metformin', dueAt: '14:00' }] }] }
  it('SET_GLASSES_VIEW is not recorded as an event', () => {
    applyAction(s, { type: 'SET_GLASSES_VIEW', view: { v: 1 }, device: 'glasses', clientEventId: id() }, T0, pts)
    expect(s.events).toHaveLength(0)
    expect(s.feed ?? []).toHaveLength(0)
  })
  it('SIM_* commands stay on the bus for the glasses but never enter the feed', () => {
    applyAction(s, { type: 'SIM_VOICE_DONE', device: 'director', clientEventId: id() }, T0, pts)
    expect(s.events.map(e => e.type)).toEqual(['SIM_VOICE_DONE'])
    expect(s.feed ?? []).toHaveLength(0)
  })
  it('a med event carries patient, room, med, device, time and the chain', () => {
    applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id() }, T0, pts)
    applyAction(s, { type: 'LOG_MED', patientId: 'p1', medKey: 'met', via: 'voice', scanLocked: true, device: 'glasses', clientEventId: id() }, T0 + 1000, pts)
    const f = s.feed![0]
    expect(f).toMatchObject({ kind: 'med_given', patientName: 'Maria Lopez', room: '12', medName: 'Metformin', device: 'glasses', timeLabel: '1:42 PM' })
    expect(f.chain).toEqual(['Wristband matched', 'Nurse confirmed via voice', 'Server accepted'])
  })
  it('no wristband step when the scan did not lock the patient', () => {
    applyAction(s, { type: 'LOG_MED', patientId: 'p1', medKey: 'met', via: 'phone', device: 'phone', clientEventId: id() }, T0, pts)
    expect(s.feed![0].chain).toEqual(['Nurse confirmed via phone', 'Server accepted'])
  })
})

describe('wound source unavailable', () => {
  const pts: PatientsData = { patients: [{ id: 'p1', name: 'Maria Lopez', room: '12', attending: 'Dr. Okafor', meds: [] }] }
  const cap = (src: 'unavailable' | 'gemini'): Action => ({
    type: 'WOUND_CAPTURED', captureId: 'c1', patientId: 'p1', device: 'glasses', clientEventId: id(), assessmentSource: src,
    finding: src === 'unavailable' ? 'Assessment unavailable: no photo captured' : 'Dry.', comparison: '', draftNote: '',
  })
  it('stores the source and refuses to send an unavailable assessment to the doctor', () => {
    applyAction(s, cap('unavailable'), T0, pts)
    expect(s.woundCaptures[0].assessmentSource).toBe('unavailable')
    const r = applyAction(s, { type: 'WOUND_SEND', captureId: 'c1', device: 'glasses', clientEventId: id() }, T0, pts)
    expect(r.ok).toBe(false)
    expect(r.message).toBe('No assessment to send')
  })
  it('validateAction accepts assessmentSource unavailable', () => {
    expect('error' in validateAction(cap('unavailable'))).toBe(false)
  })
  it('a real assessment can still be sent and appears in the feed with wound chain', () => {
    applyAction(s, cap('gemini'), T0, pts)
    expect(applyAction(s, { type: 'WOUND_SEND', captureId: 'c1', device: 'glasses', clientEventId: id() }, T0, pts).ok).toBe(true)
    expect(s.feed!.map(f => f.kind)).toEqual(['wound_captured', 'wound_sent'])
    expect(s.feed![1]).toMatchObject({ patientName: 'Maria Lopez', room: '12', device: 'glasses' })
  })
})

describe('SIM_ADD_CONFLICT_ORDER', () => {
  const pts: PatientsData = { patients: [{ id: 'P-1012', name: 'Maria Lopez', room: '12', allergies: ['Penicillin'], meds: [{ id: 'M-1', name: 'Metformin', dueAt: '14:00' }] }] }
  it('injects a synthetic order that LOG_MED can reference and that carries allergyClasses', () => {
    applyAction(s, { type: 'SIM_ADD_CONFLICT_ORDER', device: 'director', clientEventId: id() }, T0, pts)
    const o = s.extraOrders?.['P-1012']?.[0]
    expect(o).toMatchObject({ name: 'Amoxicillin', dose: '250 mg', route: 'PO', allergyClasses: ['penicillin'] })
    const r = applyAction(s, { type: 'LOG_MED', patientId: 'P-1012', medKey: o!.id, device: 'phone', clientEventId: id() }, T0, pts)
    expect(r.ok).toBe(true)
  })
  it('is idempotent per patient (second press adds nothing)', () => {
    applyAction(s, { type: 'SIM_ADD_CONFLICT_ORDER', device: 'director', clientEventId: id() }, T0, pts)
    applyAction(s, { type: 'SIM_ADD_CONFLICT_ORDER', device: 'director', clientEventId: id() }, T0, pts)
    expect(s.extraOrders?.['P-1012']).toHaveLength(1)
  })
})
