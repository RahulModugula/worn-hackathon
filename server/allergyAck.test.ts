import { describe, it, expect, beforeEach } from 'vitest'
import { applyAction, newState, validateAction, type PatientsData } from './sessionStore'
import type { Action, SessionState } from '../shared/types'

const pts: PatientsData = {
  patients: [{
    id: 'P-1012', name: 'Maria Lopez', room: '12', allergies: ['Penicillin'],
    meds: [{ id: 'M-1', name: 'Metformin', dueAt: '14:00' }],
  }],
}
let n = 0
const id = () => `a${++n}`
const T0 = 1_000_000
let s: SessionState
const act = (a: Record<string, unknown>, at = T0) =>
  applyAction(s, { clientEventId: id(), device: 'glasses', ...a } as Action, at, pts)
const addOrder = () => act({ type: 'SIM_ADD_CONFLICT_ORDER', device: 'director' })
const logOrder = (extra: Record<string, unknown> = {}) =>
  act({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'X-1', via: 'voice', ...extra }, T0 + 1000)
const ack = (extra: Record<string, unknown> = {}, at = T0 + 500) =>
  act({ type: 'ALLERGY_ACK', patientId: 'P-1012', medKey: 'X-1', via: 'voice', ...extra }, at)

beforeEach(() => {
  s = newState('t')
  act({ type: 'START_SHIFT', device: 'phone' })
  addOrder()
})

describe('LOG_MED on an allergy conflict', () => {
  it('is refused with needsConfirm until allergyConfirmed, and changes nothing', () => {
    const r = logOrder()
    expect(r.ok).toBe(false)
    expect(r.needsConfirm).toBe(true)
    expect(r.message).toBe('Chart lists Penicillin allergy')
    expect(s.medStatus['P-1012:X-1']).toBeUndefined()
    expect(s.lastMedLog).toBeNull()
  })
  it('is refused even after the glasses acknowledged the alert (the safety bug)', () => {
    expect(ack().ok).toBe(true)
    const r = logOrder({ via: 'voice' })
    expect(r.ok).toBe(false)
    expect(r.needsConfirm).toBe(true)
    expect(s.medStatus['P-1012:X-1']).toBeUndefined()
  })
  it('is accepted with allergyConfirmed:true and the feed says so', () => {
    const r = logOrder({ allergyConfirmed: true, via: 'phone', device: 'phone' })
    expect(r.ok).toBe(true)
    expect(s.feed!.at(-1)!.chain).toContain('Allergy override confirmed')
  })
  it('a non-conflicting med is untouched', () => {
    expect(act({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'voice' }, T0 + 1000).ok).toBe(true)
  })
  it('already-given still reports the conflict first', () => {
    logOrder({ allergyConfirmed: true, device: 'phone', via: 'phone' })
    const r = logOrder()
    expect(r.conflict).toBe(true)
  })
  it('validateAction bounds allergyConfirmed to a boolean', () => {
    const base = { type: 'LOG_MED', patientId: 'P-1012', medKey: 'X-1', device: 'phone', clientEventId: 'z' }
    expect('error' in validateAction({ ...base, allergyConfirmed: 'yes' })).toBe(true)
    expect('error' in validateAction({ ...base, allergyConfirmed: true })).toBe(false)
  })
})

describe('ALLERGY_ACK', () => {
  it('records the ack with key, label, device and via, and a feed entry with the chain', () => {
    const r = ack()
    expect(r.ok).toBe(true)
    expect(s.allergyAcks).toHaveLength(1)
    expect(s.allergyAcks![0]).toMatchObject({ key: 'P-1012:X-1', device: 'glasses', via: 'voice', label: '1:42 PM', atMs: T0 + 500 })
    const f = s.feed!.at(-1)!
    expect(f.kind).toBe('allergy_ack')
    expect(f.chain).toEqual([
      'New order (simulated prescriber)', 'Chart lists Penicillin allergy', 'Shown on glasses', 'Acknowledged via voice', 'Server accepted',
    ])
    expect(f).toMatchObject({ patientName: 'Maria Lopez', room: '12', medName: 'Amoxicillin' })
  })
  it('tap is reflected in the chain', () => {
    ack({ via: 'tap' })
    expect(s.feed!.at(-1)!.chain).toContain('Acknowledged via tap')
  })
  it('is idempotent by key: a second ack conflicts with the first time', () => {
    ack()
    const r = ack({ device: 'phone' }, T0 + 900)
    expect(r.ok).toBe(false)
    expect(r.conflict).toBe(true)
    expect(r.message).toBe('Already acknowledged 1:42 PM')
    expect(s.allergyAcks).toHaveLength(1)
  })
  it('refuses a med with no allergy conflict, an unknown med and an unknown patient', () => {
    expect(ack({ medKey: 'M-1' }).ok).toBe(false)
    expect(ack({ medKey: 'nope' }).ok).toBe(false)
    expect(ack({ patientId: 'nobody' }).ok).toBe(false)
    expect(s.allergyAcks).toBeUndefined()
  })
  it('is bounded by validateAction', () => {
    const base = { type: 'ALLERGY_ACK', patientId: 'P-1012', medKey: 'X-1', via: 'voice', device: 'glasses', clientEventId: 'q' }
    expect('error' in validateAction(base)).toBe(false)
    expect('error' in validateAction({ ...base, via: 'phone' })).toBe(true)
    expect('error' in validateAction({ ...base, medKey: 'x'.repeat(201) })).toBe(true)
    expect('error' in validateAction({ ...base, patientId: 5 })).toBe(true)
  })
  it('RESET_SESSION deletes allergyAcks', () => {
    ack()
    act({ type: 'RESET_SESSION', device: 'director' })
    expect('allergyAcks' in s).toBe(false)
  })
  it('replay of the same clientEventId changes nothing', () => {
    const a = { type: 'ALLERGY_ACK', patientId: 'P-1012', medKey: 'X-1', via: 'voice', device: 'glasses', clientEventId: 'same' } as Action
    applyAction(s, a, T0, pts)
    const v = s.version
    applyAction(s, a, T0 + 5, pts)
    expect(s.version).toBe(v)
    expect(s.allergyAcks).toHaveLength(1)
  })
})

describe('ALLERGY_ACK does not survive a reset', () => {
  it('an offline ack queued for the pre-reset order is rejected after RESET + re-add, which uses a fresh order id', () => {
    const first = s.extraOrders!['P-1012'][0].id
    act({ type: 'RESET_SESSION', device: 'director' })
    addOrder()
    const second = s.extraOrders!['P-1012'][0].id
    expect(second).not.toBe(first)
    const stale = ack({ medKey: first }, T0 + 2000)
    expect(stale.ok).toBe(false)
    expect(s.allergyAcks).toBeUndefined()
    // the fresh alert can still be acknowledged
    expect(ack({ medKey: second }, T0 + 2100).ok).toBe(true)
  })
  it('the first injection is still X-1 and ack of an unknown order fails closed without patient data', () => {
    expect(s.extraOrders!['P-1012'][0].id).toBe('X-1')
    const bare = newState('bare2')
    expect(applyAction(bare, { clientEventId: 'nb2', device: 'glasses', type: 'ALLERGY_ACK', patientId: 'P-1012', medKey: 'X-1', via: 'tap' } as Action, T0).ok).toBe(false)
  })
})

describe('allergy override is a phone-only decision', () => {
  it('a glasses LOG_MED with allergyConfirmed:true is refused with a clear message and changes nothing', () => {
    const r = logOrder({ allergyConfirmed: true, device: 'glasses' })
    expect(r.ok).toBe(false)
    expect(r.needsConfirm).toBeUndefined()
    expect(r.message).toBe('Allergy override must be confirmed on the phone')
    expect(s.medStatus['P-1012:X-1']).toBeUndefined()
    expect(s.lastMedLog).toBeNull()
  })
  it('a director frame cannot carry the override either; the phone can', () => {
    expect(logOrder({ allergyConfirmed: true, device: 'director' }).ok).toBe(false)
    expect(logOrder({ allergyConfirmed: true, device: 'phone', via: 'phone' }).ok).toBe(true)
  })
  it('SIM_ADD_CONFLICT_ORDER refuses without patient data, so the allergy gate cannot fail open', () => {
    const bare = newState('bare')
    const r = applyAction(bare, { clientEventId: 'nb1', device: 'director', type: 'SIM_ADD_CONFLICT_ORDER' } as Action, T0)
    expect(r.ok).toBe(false)
    expect(bare.extraOrders).toBeUndefined()
  })
})
