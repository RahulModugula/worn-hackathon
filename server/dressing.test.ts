import { describe, it, expect, beforeEach } from 'vitest'
import { applyAction, newState, validateAction, type PatientsData } from './sessionStore'
import type { Action, SessionState } from '../shared/types'

const patients: PatientsData = { nurse: { assignedPatientIds: ['p1'] }, patients: [{ id: 'p1', attending: 'Dr. Okafor', meds: [] }] }
let n = 0
const id = () => `d${++n}`
const T0 = 5_000_000
let s: SessionState
beforeEach(() => { s = newState('t') })

const captured = (over: Record<string, unknown> = {}): Action => ({
  type: 'WOUND_CAPTURED', captureId: 'cap-1', patientId: 'p1', finding: 'f', comparison: 'c', draftNote: 'd',
  device: 'glasses', clientEventId: id(), ...over,
} as Action)
const dress = (over: Record<string, unknown> = {}): Action => ({
  type: 'WOUND_SET_DRESSING', captureId: 'cap-1', dressingType: 'hydrogel', changedAtMin: 14 * 60 + 5, intervalHours: 24,
  device: 'phone', clientEventId: id(), ...over,
} as Action)
const save = (): Action => ({ type: 'WOUND_SAVE', captureId: 'cap-1', device: 'phone', clientEventId: id() })
const send = (): Action => ({ type: 'WOUND_SEND', captureId: 'cap-1', device: 'phone', clientEventId: id() })

describe('WOUND_SET_DRESSING', () => {
  it('stores nurse-entered type, changed time and computed next due on the capture', () => {
    applyAction(s, captured(), T0, patients)
    const r = applyAction(s, dress(), T0 + 1, patients)
    expect(r.ok).toBe(true)
    expect(r.state.woundCaptures[0].dressing).toEqual({
      type: 'hydrogel', changedAtMin: 845, intervalHours: 24, nextDueMin: 845, enteredBy: 'phone', atMs: T0 + 1,
    })
  })
  it('next due wraps past midnight (minutes of day)', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress({ changedAtMin: 23 * 60, intervalHours: 72 }), T0 + 1, patients)
    expect(s.woundCaptures[0].dressing!.nextDueMin).toBe(23 * 60)
  })
  it('"per protocol" (null interval) has no next due; nothing is defaulted', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress({ intervalHours: null }), T0 + 1, patients)
    expect(s.woundCaptures[0].dressing).toMatchObject({ intervalHours: null, nextDueMin: null })
  })
  it('"none" stores only the type', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress({ dressingType: 'none', changedAtMin: undefined, intervalHours: undefined }), T0 + 1, patients)
    expect(s.woundCaptures[0].dressing).toMatchObject({ type: 'none', nextDueMin: null })
    expect(s.woundCaptures[0].dressing).not.toHaveProperty('changedAtMin')
  })
  it('can be edited while the note is still a draft (captured or pending_review)', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress(), T0 + 1, patients)
    expect(applyAction(s, dress({ dressingType: 'foam' }), T0 + 2, patients).ok).toBe(true)
    expect(s.woundCaptures[0].dressing!.type).toBe('foam')
  })
  it('first-write-wins once saved or sent: conflict, nothing changes', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress(), T0 + 1, patients)
    applyAction(s, save(), T0 + 2, patients)
    const v = s.version
    const r = applyAction(s, dress({ dressingType: 'gauze' }), T0 + 3, patients)
    expect(r).toMatchObject({ ok: false, conflict: true, message: 'Already saved' })
    expect(s.woundCaptures[0].dressing!.type).toBe('hydrogel')
    expect(s.version).toBe(v)
    applyAction(s, send(), T0 + 4, patients)
    expect(applyAction(s, dress({ dressingType: 'gauze' }), T0 + 5, patients)).toMatchObject({ ok: false, conflict: true, message: 'Already sent to Dr. Okafor' })
  })
  it('is idempotent by clientEventId (replay does not rewrite)', () => {
    applyAction(s, captured(), T0, patients)
    const a = dress()
    applyAction(s, a, T0 + 1, patients)
    applyAction(s, dress({ dressingType: 'foam' }), T0 + 2, patients)
    const r = applyAction(s, a, T0 + 3, patients)
    expect(r.ok).toBe(true)
    expect(s.woundCaptures[0].dressing!.type).toBe('foam')
    expect(s.events.filter(e => e.type === 'WOUND_SET_DRESSING')).toHaveLength(2)
  })
  it('fails for an unknown capture', () => {
    expect(applyAction(s, dress({ captureId: 'nope' }), T0, patients)).toMatchObject({ ok: false, message: 'No wound capture' })
  })
  it('a later WOUND_CAPTURED upsert keeps the dressing', () => {
    applyAction(s, captured({ photoUploadFailed: true, finding: '', comparison: '', draftNote: '' }), T0, patients)
    applyAction(s, dress(), T0 + 1, patients)
    applyAction(s, captured(), T0 + 2, patients)
    expect(s.woundCaptures[0].dressing!.type).toBe('hydrogel')
  })
  it('RESET_SESSION clears it with the capture', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress(), T0 + 1, patients)
    applyAction(s, { type: 'RESET_SESSION', device: 'director', clientEventId: id() }, T0 + 2, patients)
    expect(s.woundCaptures).toEqual([])
  })
  it('run() itself rejects bad values (defence in depth, not only validateAction)', () => {
    applyAction(s, captured(), T0, patients)
    for (const bad of [{ changedAtMin: 1440 }, { changedAtMin: -1 }, { changedAtMin: 1.5 }, { changedAtMin: undefined }, { intervalHours: 12 }, { intervalHours: undefined }, { dressingType: 'plaster' }]) {
      expect(applyAction(s, dress(bad), T0 + 1, patients).ok, JSON.stringify(bad)).toBe(false)
    }
    expect(s.woundCaptures[0].dressing).toBeUndefined()
  })
  it('records a wound_dressing feed entry saying who documented it', () => {
    applyAction(s, captured(), T0, patients)
    applyAction(s, dress(), T0 + 1, patients)
    expect(s.feed!.at(-1)).toMatchObject({ kind: 'wound_dressing' })
    expect(s.feed!.at(-1)!.chain).toContain('Documented by nurse')
  })
})

describe('WOUND_SET_DRESSING validateAction bounds', () => {
  const v = (over: Record<string, unknown>) => validateAction({ ...dress(over) })
  it('accepts a good action and every preset', () => {
    expect(v({})).toHaveProperty('action')
    for (const h of [24, 48, 72, null]) expect(v({ intervalHours: h })).toHaveProperty('action')
    expect(v({ dressingType: 'none', changedAtMin: undefined, intervalHours: undefined })).toHaveProperty('action')
  })
  it('rejects bad capture ids, types, minutes and intervals', () => {
    for (const bad of [{ captureId: '../x' }, { captureId: 5 }, { dressingType: 'x' }, { dressingType: 'Hydrogel ' }, { changedAtMin: NaN }, { changedAtMin: 1440 }, { changedAtMin: -5 }, { changedAtMin: '5' }, { intervalHours: 36 }, { intervalHours: Infinity }, { intervalHours: '24' }]) {
      expect(v(bad), JSON.stringify(bad)).toHaveProperty('error')
    }
  })
})

describe('SIM_DRESSING_PRESET (Director demo preset)', () => {
  const sim = (): Action => ({ type: 'SIM_DRESSING_PRESET', device: 'director', clientEventId: id() })
  it('documents a dressing on the newest unsaved capture at the demo-clock time', () => {
    applyAction(s, { type: 'START_SHIFT', device: 'phone', clientEventId: id() }, T0, patients)
    applyAction(s, captured(), T0, patients)
    const r = applyAction(s, sim(), T0 + 120_000, patients)
    expect(r.ok).toBe(true)
    expect(r.state.woundCaptures[0].dressing).toMatchObject({ type: 'hydrogel', changedAtMin: 824, intervalHours: 24, nextDueMin: 824, enteredBy: 'director' })
  })
  it('with no capture it refuses plainly', () => {
    expect(applyAction(s, sim(), T0, patients)).toMatchObject({ ok: false, message: 'Capture a wound photo first' })
  })
})
