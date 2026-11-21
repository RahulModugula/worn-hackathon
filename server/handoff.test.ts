import { describe, it, expect, beforeEach } from 'vitest'
import { applyAction, newState, validateAction, type PatientsData } from './sessionStore'
import { criticalIndexes } from '../shared/handoff'
import type { Action, HandoffPacket, SessionState } from '../shared/types'

const pts: PatientsData = {
  nurse: { id: 'N-01', assignedPatientIds: ['P-1012', 'P-1014'] },
  handoffNurses: [{ id: 'N-01', name: 'Priya S.' }, { id: 'N-02', name: 'Marcus T.' }],
  patients: [
    {
      id: 'P-1012', name: 'Maria Lopez', room: '12', attending: 'Dr. Okafor', allergies: ['Penicillin'],
      meds: [{ id: 'M-1', name: 'Metformin', dueAt: '14:00' }],
    },
    { id: 'P-1014', name: 'James Carter', room: '14', attending: 'Dr. Nguyen', allergies: ['Sulfa'], meds: [{ id: 'M-3', name: 'Atorvastatin', dueAt: '14:30' }] },
    { id: 'P-9999', name: 'Not Assigned', room: '99', meds: [] },
  ],
}
const GLASSES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RECEIVER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let n = 0
const id = () => `h${++n}`
const T0 = 1_000_000
let s: SessionState
const act = (a: Record<string, unknown>, at = T0 + 1000) =>
  applyAction(s, { clientEventId: id(), device: 'glasses', instance: GLASSES, ...a } as Action, at, pts)
const offer = (extra: Record<string, unknown> = {}) =>
  act({ type: 'HANDOFF_OFFER', handoffId: 'ho1', patientId: 'P-1012', toNurseId: 'N-02', ...extra })
const readback = (index: number, extra: Record<string, unknown> = {}) =>
  act({ type: 'HANDOFF_READBACK', handoffId: 'ho1', index, device: 'phone', instance: RECEIVER, ...extra })
const accept = (extra: Record<string, unknown> = {}) =>
  act({ type: 'HANDOFF_ACCEPT', handoffId: 'ho1', device: 'phone', instance: RECEIVER, ...extra }, T0 + 5000)
const pkt = (): HandoffPacket => s.handoffs![0]

beforeEach(() => {
  s = newState('t')
  act({ type: 'START_SHIFT', device: 'phone' }, T0)
  // Metformin given from the glasses: a critical (recent) item in the packet.
  act({ type: 'LOG_MED', patientId: 'P-1012', medKey: 'M-1', via: 'voice' }, T0 + 500)
})

describe('HANDOFF_OFFER', () => {
  it('builds an I-PASS packet from the shift log, stamps the offering instance and shows the glasses notice', () => {
    const r = offer({ severity: 'Watch' })
    expect(r.ok).toBe(true)
    const p = pkt()
    expect(p).toMatchObject({ handoffId: 'ho1', patientId: 'P-1012', fromNurseId: 'N-01', toNurseId: 'N-02', severity: 'Watch', status: 'offered', offeredByInstance: GLASSES, offeredVia: 'glasses', readBack: [] })
    expect(p.createdLabel).toBe('1:42 PM')
    expect(p.items.find((i) => i.section === 'I')?.text).toBe('Illness severity: Watch')
    expect(p.items.some((i) => i.section === 'S' && i.text === 'Metformin given 1:42 PM via voice' && i.critical)).toBe(true)
    expect(s.glassesNotice).toMatchObject({ text: 'Handoff sent · Marcus T.', kind: 'handoff' })
    expect(s.feed!.at(-1)).toMatchObject({ kind: 'handoff_offered', patientName: 'Maria Lopez', room: '12', label: 'Priya S. to Marcus T.' })
    expect(s.feed!.at(-1)!.chain).toEqual(['Built from shift log', 'Offered from glasses', 'Server accepted'])
  })
  it('severity is Not stated when the nurse did not choose', () => {
    offer()
    expect(pkt().severity).toBeUndefined()
    expect(pkt().items.find((i) => i.section === 'I')?.text).toBe('Illness severity: Not stated')
  })
  it('an offer from the phone is honestly labelled', () => {
    offer({ device: 'phone', instance: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    expect(pkt().offeredVia).toBe('phone')
    expect(s.feed!.at(-1)!.chain[1]).toBe('Offered from phone')
  })
  it('refuses a patient not on the nurse list, an unknown patient or nurse, and handing off to yourself', () => {
    expect(offer({ patientId: 'P-9999' })).toMatchObject({ ok: false, message: 'Not on your list' })
    expect(offer({ patientId: 'nobody' }).ok).toBe(false)
    expect(offer({ toNurseId: 'N-77' })).toMatchObject({ ok: false, message: 'Unknown nurse' })
    expect(offer({ toNurseId: 'N-01' })).toMatchObject({ ok: false, message: 'Pick the receiving nurse' })
    expect(s.handoffs).toBeUndefined()
  })
  it('a repeated handoffId or an already open offer for the same patient and nurse conflicts', () => {
    offer()
    expect(offer()).toMatchObject({ ok: false, conflict: true })
    expect(offer({ handoffId: 'ho2' })).toMatchObject({ ok: false, conflict: true, message: 'Handoff already offered' })
    expect(s.handoffs).toHaveLength(1)
  })
  it('keeps only the newest 10 packets', () => {
    for (let i = 0; i < 12; i++) {
      expect(offer({ handoffId: `ho-${i}` }).ok).toBe(true)
      const h = s.handoffs!.at(-1)!
      for (const c of criticalIndexes(h.items)) act({ type: 'HANDOFF_READBACK', handoffId: h.handoffId, index: c, device: 'phone', instance: RECEIVER })
      expect(act({ type: 'HANDOFF_ACCEPT', handoffId: h.handoffId, device: 'phone', instance: RECEIVER }).ok).toBe(true) // closes the open offer
    }
    expect(s.handoffs).toHaveLength(10)
    expect(s.handoffs![0].handoffId).toBe('ho-2')
  })
  it('is idempotent by clientEventId', () => {
    const a = { type: 'HANDOFF_OFFER', handoffId: 'ho1', patientId: 'P-1012', toNurseId: 'N-02', device: 'glasses', instance: GLASSES, clientEventId: 'same' } as Action
    applyAction(s, a, T0, pts)
    const v = s.version
    applyAction(s, a, T0 + 5, pts)
    expect(s.version).toBe(v)
    expect(s.handoffs).toHaveLength(1)
  })
})

describe('HANDOFF_READBACK', () => {
  beforeEach(() => { offer() })
  it('accepts only critical items from the receiving instance and is idempotent', () => {
    const crit = criticalIndexes(pkt().items)
    expect(crit.length).toBeGreaterThanOrEqual(2) // allergies + the med given in the last 4 h
    const nonCritical = pkt().items.findIndex((i) => !i.critical)
    expect(readback(nonCritical)).toMatchObject({ ok: false, message: 'Not a critical item' })
    expect(readback(999).ok).toBe(false)
    expect(readback(-1).ok).toBe(false)
    expect(readback(crit[0]).ok).toBe(true)
    expect(readback(crit[0]).ok).toBe(true)
    expect(pkt().readBack).toEqual([crit[0]])
  })
  it('the offering instance cannot read back its own packet', () => {
    const crit = criticalIndexes(pkt().items)
    expect(readback(crit[0], { instance: GLASSES })).toMatchObject({ ok: false, message: "Read back on the receiving nurse's device" })
    expect(readback(crit[0], { instance: undefined }).ok).toBe(false) // unknown instance fails closed
    expect(pkt().readBack).toEqual([])
  })
  it('an unknown handoff is refused', () => {
    expect(readback(0, { handoffId: 'nope' })).toMatchObject({ ok: false, message: 'No such handoff' })
  })
})

describe('HANDOFF_ACCEPT', () => {
  beforeEach(() => { offer() })
  const readAll = () => criticalIndexes(pkt().items).forEach((i) => readback(i))

  it('is refused until every critical item is read back, naming how many remain', () => {
    const crit = criticalIndexes(pkt().items)
    expect(accept()).toMatchObject({ ok: false, message: `Read back ${crit.length} critical items first` })
    readback(crit[0])
    expect(accept()).toMatchObject({ ok: false, message: `Read back ${crit.length - 1} critical items first` })
    expect(pkt().status).toBe('offered')
  })
  it("is refused on the offering instance: 'Accept on the receiving nurse's device'", () => {
    readAll()
    expect(accept({ instance: GLASSES })).toMatchObject({ ok: false, message: "Accept on the receiving nurse's device" })
    expect(accept({ instance: undefined })).toMatchObject({ ok: false, message: "Accept on the receiving nurse's device" })
    expect(pkt().status).toBe('offered')
  })
  it('succeeds on another device after the read-back: notice, label, feed chain', () => {
    readAll()
    const r = accept()
    expect(r.ok).toBe(true)
    expect(pkt()).toMatchObject({ status: 'accepted', acceptedAtMs: T0 + 5000, acceptedLabel: '1:42 PM', acceptedByInstance: RECEIVER })
    expect(s.glassesNotice).toMatchObject({ text: 'Handoff accepted · Marcus T.', kind: 'handoff' })
    const f = s.feed!.at(-1)!
    expect(f.kind).toBe('handoff_accepted')
    expect(f.chain).toEqual(['Built from shift log', 'Offered from glasses', `${criticalIndexes(pkt().items).length} critical items read back`, 'Accepted on another device', 'Server accepted'])
  })
  it('the second accept is first-write-wins with the first acceptor and time', () => {
    readAll()
    accept()
    const again = act({ type: 'HANDOFF_ACCEPT', handoffId: 'ho1', device: 'phone', instance: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, T0 + 9000)
    expect(again).toMatchObject({ ok: false, conflict: true, message: 'Already accepted by Marcus T. 1:42 PM' })
    expect(pkt().acceptedByInstance).toBe(RECEIVER)
  })
  it('readback after acceptance conflicts and changes nothing', () => {
    readAll(); accept()
    const before = pkt().readBack.length
    expect(readback(0)).toMatchObject({ ok: false, conflict: true })
    expect(pkt().readBack).toHaveLength(before)
  })
  it('a packet with no critical items can be accepted straight away (from another device)', () => {
    const empty = newState('e')
    const only: PatientsData = { ...pts, patients: [{ id: 'P-1014', name: 'James Carter', room: '14', meds: [] }] }
    const run = (a: Record<string, unknown>) => applyAction(empty, { clientEventId: id(), device: 'glasses', instance: GLASSES, ...a } as Action, T0, only)
    run({ type: 'HANDOFF_OFFER', handoffId: 'e1', patientId: 'P-1014', toNurseId: 'N-02' })
    expect(empty.handoffs![0].items.some((i) => i.critical)).toBe(false)
    expect(run({ type: 'HANDOFF_ACCEPT', handoffId: 'e1', device: 'phone', instance: RECEIVER }).ok).toBe(true)
  })
  it('unknown handoff is refused', () => {
    expect(accept({ handoffId: 'nope' })).toMatchObject({ ok: false, message: 'No such handoff' })
  })
})

describe('reset and validation', () => {
  it('RESET_SESSION deletes handoffs (Object.assign does not clear optional keys)', () => {
    offer()
    act({ type: 'RESET_SESSION', device: 'director' })
    expect('handoffs' in s).toBe(false)
  })
  const base = { clientEventId: 'v1', device: 'phone' }
  it('bounds HANDOFF_OFFER, HANDOFF_READBACK and HANDOFF_ACCEPT', () => {
    const o = { ...base, type: 'HANDOFF_OFFER', handoffId: 'ho1', patientId: 'P-1012', toNurseId: 'N-02' }
    expect('error' in validateAction(o)).toBe(false)
    expect('error' in validateAction({ ...o, handoffId: 'bad id!' })).toBe(true)
    expect('error' in validateAction({ ...o, severity: 'Critical' })).toBe(true)
    expect('error' in validateAction({ ...o, severity: 'Unstable' })).toBe(false)
    expect('error' in validateAction({ ...o, toNurseId: 'x'.repeat(300) })).toBe(true)
    const r = { ...base, type: 'HANDOFF_READBACK', handoffId: 'ho1', index: 2 }
    expect('error' in validateAction(r)).toBe(false)
    for (const bad of [-1, 1.5, 1000, '2', NaN, Infinity]) expect('error' in validateAction({ ...r, index: bad })).toBe(true)
    expect('error' in validateAction({ ...base, type: 'HANDOFF_ACCEPT', handoffId: 'ho1' })).toBe(false)
    expect('error' in validateAction({ ...base, type: 'HANDOFF_ACCEPT' })).toBe(true)
  })
  it('an `instance` in the frame body is dropped: only the server may stamp it', () => {
    const v = validateAction({ ...base, type: 'HANDOFF_ACCEPT', handoffId: 'ho1', instance: 'forged' })
    expect('action' in v && 'instance' in v.action).toBe(false)
  })
  it('a SIM_* payload rides on the bus event as detail; a non-SIM action never records detail', () => {
    act({ type: 'SIM_HANDOFF_OFFER', device: 'director', payload: { toNurseId: 'N-02' } })
    act({ type: 'SIM_VOICE_DONE', device: 'director' })
    offer()
    const evs = s.events.filter((e) => e.type === 'SIM_HANDOFF_OFFER' || e.type === 'SIM_VOICE_DONE' || e.type === 'HANDOFF_OFFER')
    expect(evs.map((e) => [e.type, e.detail])).toEqual([['SIM_HANDOFF_OFFER', { toNurseId: 'N-02' }], ['SIM_VOICE_DONE', undefined], ['HANDOFF_OFFER', undefined]])
  })
  it('SIM_HANDOFF_OFFER and SIM_CHAOS_DROP payloads are bounded', () => {
    const sim = (type: string, payload: unknown) => ({ ...base, device: 'director', type, payload })
    expect('error' in validateAction(sim('SIM_HANDOFF_OFFER', { toNurseId: 'N-02', severity: 'Watch' }))).toBe(false)
    expect('error' in validateAction(sim('SIM_HANDOFF_OFFER', { severity: 'Bad' }))).toBe(true)
    expect('error' in validateAction(sim('SIM_HANDOFF_OFFER', { toNurseId: 5 }))).toBe(true)
    expect('error' in validateAction(sim('SIM_CHAOS_DROP', { ms: 3000 }))).toBe(false)
    expect('error' in validateAction(sim('SIM_CHAOS_DROP', { ms: 15000, thenDone: true }))).toBe(false)
    for (const bad of [{ ms: 2999 }, { ms: 15001 }, { ms: 'x' }, { ms: 5000.5 }, {}, { ms: 5000, thenDone: 'y' }]) {
      expect('error' in validateAction(sim('SIM_CHAOS_DROP', bad))).toBe(true)
    }
  })
})

describe('fuzz: accepted implies every critical item was read back, on a different instance', () => {
  // Deterministic PRNG so a failure is reproducible.
  function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } }
  let totalAccepts = 0
  const instances = [GLASSES, RECEIVER, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', undefined]
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed)
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
      const st = newState('fz')
      const run = (a: Record<string, unknown>, at: number) => applyAction(st, { clientEventId: `fz${seed}-${n++}`, ...a } as Action, at, pts)
      run({ type: 'START_SHIFT', device: 'phone' }, T0)
      let sawAccept = 0
      for (let step = 0; step < 300; step++) {
        const at = T0 + step * 1000
        const hid = pick(['a', 'b', 'c'])
        const inst = pick(instances)
        const dev = pick(['glasses', 'phone'] as const)
        switch (Math.floor(r() * 7)) {
          case 0: run({ type: 'HANDOFF_OFFER', handoffId: hid + step % 4, patientId: pick(['P-1012', 'P-1014', 'P-9999']), toNurseId: pick(['N-02', 'N-01', 'N-7']), device: dev, instance: inst }, at); break
          case 1: case 2: case 3: {
            const h = st.handoffs?.find((x) => x.handoffId.startsWith(hid))
            run({ type: 'HANDOFF_READBACK', handoffId: h?.handoffId ?? hid, index: Math.floor(r() * 12) - 1, device: dev, instance: inst }, at); break
          }
          case 4: case 5: {
            const h = st.handoffs?.find((x) => x.handoffId.startsWith(hid))
            const was = h?.status
            const res = run({ type: 'HANDOFF_ACCEPT', handoffId: h?.handoffId ?? hid, device: dev, instance: inst }, at)
            if (res.ok) { sawAccept++; expect(was).toBe('offered') }
            break
          }
          default: run({ type: 'LOG_MED', patientId: pick(['P-1012', 'P-1014']), medKey: pick(['M-1', 'M-3']), via: 'voice', device: dev }, at)
        }
        for (const h of st.handoffs ?? []) {
          if (h.status !== 'accepted') continue
          for (const c of criticalIndexes(h.items)) expect(h.readBack, `seed ${seed} step ${step}`).toContain(c)
          expect(h.acceptedByInstance).toBeTruthy()
          expect(h.acceptedByInstance).not.toBe(h.offeredByInstance)
        }
        expect((st.handoffs ?? []).length).toBeLessThanOrEqual(10)
      }
      totalAccepts += sawAccept
    })
  }
  it('the fuzz actually reaches accepted handoffs (the invariant is exercised, not vacuous)', () => {
    expect(totalAccepts).toBeGreaterThan(5)
  })
})
