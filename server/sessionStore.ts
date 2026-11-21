import type { Action, ActionResult, DressingType, SessionState, MedStatus, WoundCapture, WoundDressing, FeedEntry, ExtraOrder, TelemetryMetric, HandoffPacket } from '../shared/types'
import { DRESSING_INTERVAL_PRESETS, DRESSING_TYPES, MAX_ALLERGY_ACKS, MAX_HANDOFFS, NO_AI_REVIEW, SEVERITIES, SIM_TYPES, TELEMETRY_KEEP, TELEMETRY_METRICS } from '../shared/types'
import { ACTIONABLE_WINDOW_MIN, hhmmToMinutes, longTime, minutesUntil } from '../shared/clock'
import { CONFLICT_ORDER, checkAllergy } from '../shared/allergy'
import { buildHandoff, criticalIndexes, type HandoffPatient } from '../shared/handoff'

export const UNDO_WINDOW_MS = 10_000
export const MAX_SEEN_IDS = 200
export const MAX_SESSIONS = 50
export const DEFAULT_BASE_MIN = 822 // 1:42 PM
export const MAX_WOUND_CAPTURES = 20
export const NOT_ON_LIST = 'Not on your list'
export const MAX_FEED = 60
export const NOT_RECEIVER_ACCEPT = "Accept on the receiving nurse's device"
export const NOT_RECEIVER_READBACK = "Read back on the receiving nurse's device"
/** Commands that are transport, not events: never recorded on the bus (they would flood the 200-event buffer). */
const NOT_EVENTS: readonly string[] = ['SET_GLASSES_VIEW', 'TELEMETRY_SAMPLE']
const CAPTURE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Minimal patient shape the store needs; injected so tests use inline fixtures. */
export interface PatientLike {
  id: string
  name?: string
  room?: string
  attending?: string
  allergies?: string[]
  meds?: { id: string; name?: string; dueAt?: string; allergyClasses?: string[] }[]
  [k: string]: unknown
}
export interface PatientsData {
  nurse?: { id?: string; assignedPatientIds?: string[] }
  /** Synthetic nurses a handoff can go between (data/patients.json). */
  handoffNurses?: { id: string; name: string }[]
  patients: PatientLike[]
}

export const sessions = new Map<string, SessionState>()
/** Replay cache: the result WITHOUT the state snapshot (it is re-attached on replay), so memory stays small. */
const seen = new WeakMap<SessionState, Map<string, Omit<ActionResult, 'state'>>>()

/** Results returned from the replay cache: a repeated action must not re-run server side effects (timers, fan-out). */
const replays = new WeakSet<object>()
export const isReplay = (r: ActionResult): boolean => replays.has(r)

export function newState(id: string): SessionState {
  return {
    id, version: 0, shift: null, clock: null, clockOffsetMin: 0, activePatientId: null,
    medStatus: {}, woundCaptures: [], glassesNotice: null, events: [], eventSeq: 0, lastMedLog: null,
    glassesViewState: null, photoUploadShouldFail: false,
  }
}

export class SessionCapError extends Error {}

/**
 * Returns the session, creating it if needed. The map is a cap-bounded LRU: when full, the least recently used
 * session that is not `isBusy` (has no connected socket) is evicted; if every session is busy this throws.
 */
export function getOrCreateSession(id: string, isBusy: (id: string) => boolean = () => false, max = MAX_SESSIONS): SessionState {
  let s = sessions.get(id)
  if (s) { sessions.delete(id); sessions.set(id, s); return s } // touch: most recently used last
  while (sessions.size >= max) {
    const victim = [...sessions.keys()].find(k => !isBusy(k))
    if (victim === undefined) throw new SessionCapError('too many sessions')
    sessions.delete(victim)
  }
  s = newState(id)
  sessions.set(id, s)
  return s
}

export function demoMinutes(s: SessionState, nowMs: number): number | null {
  if (!s.clock) return null
  return s.clock.baseMin + s.clockOffsetMin + (nowMs - s.clock.startedAtMs) / 60000
}

export function formatClock(totalMin: number): string {
  const m = Math.floor(totalMin) % 1440
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(mm).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`
}

function snapshot(s: SessionState): SessionState {
  return structuredClone(s)
}

/**
 * Synchronous and pure given (state, action, nowMs, patients): mutates `session`
 * in place (single-threaded Node makes first-write-wins race free) and returns the result.
 */
export function applyAction(
  session: SessionState,
  action: Action,
  nowMs: number,
  patients?: PatientsData,
): ActionResult {
  let ids = seen.get(session)
  if (!ids) { ids = new Map(); seen.set(session, ids) }
  // Scoped by device: two devices that happen to pick the same id are two different actions.
  const idKey = `${action.device}:${action.clientEventId}`
  const prior = ids.get(idKey)
  if (prior) { const r = { ...prior, state: snapshot(session) }; replays.add(r); return r }

  const result = run(session, action, nowMs, patients)
  if (result.ok) {
    session.version++
    if (action.type !== 'RESET_SESSION' && !NOT_EVENTS.includes(action.type)) {
      // A Director command's (bounded, validated) payload rides on the bus so the glasses can replay it.
      const detail = action.type.startsWith('SIM_') ? (action as { payload?: unknown }).payload : undefined
      session.events.push({ seq: ++session.eventSeq, atMs: nowMs, type: action.type, device: action.device, ...(detail !== undefined ? { detail } : {}) })
      if (session.events.length > 200) session.events.shift()
    }
    recordFeed(session, action, nowMs, patients)
  }
  ids.set(idKey, result)
  if (ids.size > MAX_SEEN_IDS) ids.delete(ids.keys().next().value as string)
  return { ...result, state: snapshot(session) }
}

/** Med and wound events only, with who/what/when and the verification chain. SIM_*, views and telemetry never enter. */
function recordFeed(s: SessionState, a: Action, now: number, patients?: PatientsData): void {
  let patientId: string | undefined
  let kind: string | undefined
  let medName: string | undefined
  let label: string | undefined
  const chain: string[] = []
  switch (a.type) {
    case 'LOG_MED': {
      kind = 'med_given'; patientId = a.patientId
      medName = findMed(s, patients, a.patientId, a.medKey)?.name
      if (a.scanLocked === true) chain.push('Wristband matched')
      chain.push('Nurse confirmed via ' + (a.via ?? a.device))
      if (a.earlyConfirmed === true) chain.push('Early dose confirmed')
      if (a.allergyConfirmed === true) chain.push('Allergy override confirmed')
      break
    }
    case 'ALLERGY_ACK': {
      kind = 'allergy_ack'; patientId = a.patientId
      const med = findMed(s, patients, a.patientId, a.medKey)
      medName = med?.name
      const hit = allergyHit(patients, a.patientId, med)
      chain.push(ownOrders(s, a.patientId)?.some(m => m.id === a.medKey) ? 'New order (simulated prescriber)' : 'Order on chart')
      chain.push(`Chart lists ${hit?.allergy ?? 'an'} allergy`)
      chain.push('Shown on glasses')
      chain.push('Acknowledged via ' + (a.via ?? 'tap'))
      break
    }
    case 'UNDO_LAST_MED': {
      kind = 'med_undone'
      const last = s.feed?.slice().reverse().find(f => f.kind === 'med_given')
      patientId = last?.patientId; medName = last?.medName
      chain.push('Undone from ' + a.device)
      break
    }
    case 'WOUND_CAPTURED': {
      const cur = findCapture(s, a.captureId)
      if (!cur || cur.status !== 'pending_review' || !a.finding) return // only the assessed capture is an event
      kind = 'wound_captured'; patientId = cur.patientId
      chain.push('Photo captured')
      chain.push(cur.assessmentSource === 'gemini' ? 'Assessed by Gemini' : cur.assessmentSource === 'fallback' ? 'No AI review (photo only)' : 'Assessment unavailable')
      break
    }
    case 'WOUND_SAVE': case 'WOUND_SEND': {
      const cur = findCapture(s, a.captureId)
      kind = a.type === 'WOUND_SAVE' ? 'wound_saved' : 'wound_sent'; patientId = cur?.patientId
      chain.push('Nurse reviewed note')
      if (a.type === 'WOUND_SEND') chain.push('Sent to ' + (cur?.sentTo ?? 'the doctor'))
      break
    }
    case 'WOUND_SET_DRESSING': {
      kind = 'wound_dressing'; patientId = findCapture(s, a.captureId)?.patientId
      chain.push('Documented by nurse')
      break
    }
    case 'DR_REPLY': {
      kind = 'dr_reply'; patientId = a.captureId ? findCapture(s, a.captureId)?.patientId : undefined
      chain.push('Reply from ' + a.from)
      break
    }
    case 'HANDOFF_OFFER': case 'HANDOFF_ACCEPT': {
      const h = handoffOf(s, a.handoffId)
      if (!h) return
      patientId = h.patientId
      kind = a.type === 'HANDOFF_OFFER' ? 'handoff_offered' : 'handoff_accepted'
      label = `${nurseName(patients, h.fromNurseId)} to ${nurseName(patients, h.toNurseId)}`
      chain.push('Built from shift log')
      chain.push(h.offeredVia === 'glasses' ? 'Offered from glasses' : 'Offered from phone')
      if (a.type === 'HANDOFF_ACCEPT') {
        chain.push(`${criticalIndexes(h.items).length} critical items read back`)
        chain.push('Accepted on another device')
      }
      break
    }
    default: return
  }
  chain.push('Server accepted')
  const p = patients?.patients.find(x => x.id === patientId)
  const dm = demoMinutes(s, now)
  const entry: FeedEntry = {
    seq: s.eventSeq, atMs: now, kind, device: a.device, timeLabel: dm === null ? new Date(now).toISOString() : formatClock(dm), chain,
    ...(patientId ? { patientId } : {}), ...(p?.name ? { patientName: p.name } : {}), ...(p?.room ? { room: p.room } : {}),
    ...(medName ? { medName } : {}), ...(label ? { label } : {}),
  }
  const feed = s.feed ?? (s.feed = [])
  feed.push(entry)
  if (feed.length > MAX_FEED) feed.shift()
}

function allergyHit(patients: PatientsData | undefined, patientId: string, med: { name?: string; dose?: string; allergyClasses?: string[] } | undefined) {
  const p = patients?.patients.find(x => x.id === patientId)
  if (!p || !med) return null
  return checkAllergy({ allergies: p.allergies }, { name: med.name ?? '', dose: med.dose, allergyClasses: med.allergyClasses })
}

function handoffOf(s: SessionState, handoffId: string): HandoffPacket | undefined {
  return s.handoffs?.find(h => h.handoffId === handoffId)
}

function nurseName(patients: PatientsData | undefined, id: string): string {
  return patients?.handoffNurses?.find(n => n.id === id)?.name ?? id
}

/** The receiving side is any connection instance that is known and is not the one that made the offer (fails closed). */
function isReceiver(instance: string | undefined, h: HandoffPacket): boolean {
  return instance !== undefined && instance !== h.offeredByInstance
}

function findMed(s: SessionState, patients: PatientsData | undefined, patientId: string, medKey: string) {
  return patients?.patients.find(p => p.id === patientId)?.meds?.find(m => m.id === medKey)
    ?? ownOrders(s, patientId)?.find(m => m.id === medKey)
}

/** extraOrders[patientId] by OWN key only: "__proto__" / "constructor" must not resolve to Object.prototype members. */
function ownOrders(s: SessionState, patientId: string): ExtraOrder[] | undefined {
  const o = s.extraOrders
  return o && Object.hasOwn(o, patientId) ? o[patientId] : undefined
}

function acceptedText(h: HandoffPacket, patients: PatientsData | undefined): string {
  return `Already accepted by ${nurseName(patients, h.toNurseId)} ${h.acceptedLabel ?? ''}`.trim()
}

function findCapture(s: SessionState, captureId: string): WoundCapture | undefined {
  return s.woundCaptures.find(c => c.captureId === captureId)
}

type Partial_ = Omit<ActionResult, 'state'>

function run(s: SessionState, a: Action, now: number, patients?: PatientsData): Partial_ {
  switch (a.type) {
    case 'START_SHIFT':
      s.shift = { startedAtMs: now }
      s.clock = { baseMin: a.baseMin ?? DEFAULT_BASE_MIN, startedAtMs: now }
      return { ok: true }
    case 'SET_ACTIVE_PATIENT': {
      const assigned = patients?.nurse?.assignedPatientIds
      if (a.patientId !== null && assigned && !assigned.includes(a.patientId)) {
        return { ok: false, message: NOT_ON_LIST }
      }
      s.activePatientId = a.patientId
      return { ok: true }
    }
    case 'LOG_MED': {
      // The override is a deliberate decision made on the phone; a frame from any other device never carries it.
      if (a.allergyConfirmed === true && a.device !== 'phone') return { ok: false, message: 'Allergy override must be confirmed on the phone' }
      const key = `${a.patientId}:${a.medKey}`
      const known = patients?.patients.find(p => p.id === a.patientId)
      if (patients && (!known || (known.meds && !known.meds.some(m => m.id === a.medKey) && !ownOrders(s, a.patientId)?.some(m => m.id === a.medKey)))) {
        return { ok: false, message: 'Unknown patient or med' }
      }
      const cur = s.medStatus[key]
      if (cur?.status === 'given') {
        return { ok: false, conflict: true, message: `Already given ${cur.givenAtLabel ?? ''} via ${cur.via ?? cur.by ?? ''}`.replace(/\s+/g, ' ') }
      }
      const dm = demoMinutes(s, now)
      const medRec = findMed(s, patients, a.patientId, a.medKey)
      // An allergy conflict needs a deliberate confirm on every log; acknowledging the alert on the glasses is not consent to give it.
      const hit = allergyHit(patients, a.patientId, medRec)
      if (hit && a.allergyConfirmed !== true) return { ok: false, needsConfirm: true, message: `Chart lists ${hit.allergy} allergy` }
      const dueAt = medRec?.dueAt
      if (dueAt && dm !== null && a.earlyConfirmed !== true) {
        const due = hhmmToMinutes(dueAt)
        if (minutesUntil(due, dm) > ACTIONABLE_WINDOW_MIN) {
          return { ok: false, needsConfirm: true, message: 'Not due until ' + longTime(due) }
        }
      }
      const entry: MedStatus = {
        status: 'given', givenAtMs: now, via: a.via ?? a.device as MedStatus['via'], by: a.device,
        givenAtLabel: dm === null ? new Date(now).toISOString() : formatClock(dm),
      }
      s.medStatus[key] = entry
      s.lastMedLog = { key, acceptedAtMs: now, device: a.device }
      return { ok: true }
    }
    case 'ALLERGY_ACK': {
      const key = `${a.patientId}:${a.medKey}`
      const med = findMed(s, patients, a.patientId, a.medKey)
      if (!patients || !med) return { ok: false, message: 'Unknown patient or med' }
      if (!allergyHit(patients, a.patientId, med)) return { ok: false, message: 'No allergy conflict' }
      const prior = s.allergyAcks?.find(x => x.key === key)
      if (prior) return { ok: false, conflict: true, message: `Already acknowledged ${prior.label}` }
      const dm = demoMinutes(s, now)
      const acks = s.allergyAcks ?? (s.allergyAcks = [])
      acks.push({ key, atMs: now, label: dm === null ? new Date(now).toISOString() : formatClock(dm), device: a.device, via: a.via ?? 'tap' })
      while (acks.length > MAX_ALLERGY_ACKS) acks.shift()
      return { ok: true }
    }
    case 'HANDOFF_OFFER': {
      const assigned = patients?.nurse?.assignedPatientIds
      if (assigned && !assigned.includes(a.patientId)) return { ok: false, message: NOT_ON_LIST }
      const patient = patients?.patients.find(p => p.id === a.patientId)
      if (!patients || !patient) return { ok: false, message: 'Unknown patient' }
      const to = patients.handoffNurses?.find(n => n.id === a.toNurseId)
      if (!to) return { ok: false, message: 'Unknown nurse' }
      const fromId = patients.nurse?.id ?? 'N-01'
      if (a.toNurseId === fromId) return { ok: false, message: 'Pick the receiving nurse' }
      if (handoffOf(s, a.handoffId)) return { ok: false, conflict: true, message: 'Already offered' }
      if (s.handoffs?.some(h => h.status === 'offered' && h.patientId === a.patientId && h.toNurseId === a.toNurseId)) {
        return { ok: false, conflict: true, message: 'Handoff already offered' }
      }
      const dm = demoMinutes(s, now)
      const view: HandoffPatient = {
        id: patient.id, name: patient.name ?? patient.id, room: patient.room ?? '', attending: patient.attending, allergies: patient.allergies,
        meds: (patient.meds ?? []).flatMap(m => m.dueAt ? [{ id: m.id, name: m.name ?? m.id, dueAt: m.dueAt, allergyClasses: m.allergyClasses, dose: (m as { dose?: string }).dose }] : []),
        prn: patient.prn as HandoffPatient['prn'], wound: patient.wound as HandoffPatient['wound'],
      }
      const items = buildHandoff(s, view, ownOrders(s, a.patientId) ?? [], dm ?? DEFAULT_BASE_MIN, a.severity)
      const list = s.handoffs ?? (s.handoffs = [])
      list.push({
        handoffId: a.handoffId, patientId: a.patientId, fromNurseId: fromId, toNurseId: a.toNurseId, ...(a.severity ? { severity: a.severity } : {}),
        items, status: 'offered', offeredByInstance: a.instance ?? '', offeredVia: a.device === 'glasses' ? 'glasses' : 'phone',
        createdLabel: dm === null ? new Date(now).toISOString() : formatClock(dm), readBack: [],
      })
      while (list.length > MAX_HANDOFFS) list.shift()
      s.glassesNotice = { text: `Handoff sent · ${to.name}`, kind: 'handoff', atMs: now }
      return { ok: true }
    }
    case 'HANDOFF_READBACK': {
      const h = handoffOf(s, a.handoffId)
      if (!h) return { ok: false, message: 'No such handoff' }
      if (h.status === 'accepted') return { ok: false, conflict: true, message: acceptedText(h, patients) }
      if (!isReceiver(a.instance, h)) return { ok: false, message: NOT_RECEIVER_READBACK }
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= h.items.length) return { ok: false, message: 'No such item' }
      if (!h.items[a.index].critical) return { ok: false, message: 'Not a critical item' }
      if (!h.readBack.includes(a.index)) { h.readBack.push(a.index); h.readBack.sort((x, y) => x - y) }
      return { ok: true }
    }
    case 'HANDOFF_ACCEPT': {
      const h = handoffOf(s, a.handoffId)
      if (!h) return { ok: false, message: 'No such handoff' }
      if (h.status === 'accepted') return { ok: false, conflict: true, message: acceptedText(h, patients) }
      if (!isReceiver(a.instance, h)) return { ok: false, message: NOT_RECEIVER_ACCEPT }
      const unread = criticalIndexes(h.items).filter(i => !h.readBack.includes(i)).length
      if (unread > 0) return { ok: false, message: `Read back ${unread} critical items first` }
      const dm = demoMinutes(s, now)
      h.status = 'accepted'
      h.acceptedAtMs = now
      h.acceptedLabel = dm === null ? new Date(now).toISOString() : formatClock(dm)
      h.acceptedByInstance = a.instance
      s.glassesNotice = { text: `Handoff accepted · ${nurseName(patients, h.toNurseId)}`, kind: 'handoff', atMs: now }
      return { ok: true }
    }
    case 'UNDO_LAST_MED': {
      const l = s.lastMedLog
      if (!l) return { ok: false, message: 'Nothing to undo' }
      if (now - l.acceptedAtMs > UNDO_WINDOW_MS) return { ok: false, message: 'Too late to undo' }
      s.medStatus[l.key] = { status: 'due' }
      s.lastMedLog = null
      return { ok: true }
    }
    case 'RESET_SESSION': {
      const fresh = newState(s.id)
      fresh.version = s.version
      fresh.glassesViewState = null
      fresh.eventSeq = s.eventSeq // monotonic: client cursors must never see seq go backwards
      if (s.orderSeq !== undefined) fresh.orderSeq = s.orderSeq // injected order ids are never reused after a reset
      Object.assign(s, fresh)
      s.events = []
      delete s.telemetry; delete s.feed; delete s.extraOrders; delete s.allergyAcks; delete s.handoffs // optional keys survive Object.assign
      return { ok: true, clearOutbox: true }
    }
    case 'TELEMETRY_SAMPLE': {
      if (!TELEMETRY_METRICS.includes(a.metric) || !Number.isFinite(a.ms) || a.ms < 0) return { ok: false, message: 'Bad sample' }
      const t = s.telemetry ?? (s.telemetry = {})
      const arr = t[a.metric as TelemetryMetric] ?? (t[a.metric as TelemetryMetric] = [])
      arr.push(Math.round(a.ms))
      while (arr.length > TELEMETRY_KEEP) arr.shift()
      return { ok: true }
    }
    case 'SET_CLOCK_OFFSET':
      if (!Number.isFinite(a.offsetMin)) return { ok: false, message: 'Invalid offset' }
      s.clockOffsetMin = a.offsetMin
      return { ok: true }
    case 'WOUND_CAPTURED': {
      if (patients && !patients.patients.some(p => p.id === a.patientId)) return { ok: false, message: 'Unknown patient' }
      const hasAssessment = a.finding.length > 0
      // No AI review ran: store the non-clinical template, never client-supplied clinical-sounding text.
      const w = hasAssessment && a.assessmentSource === 'fallback' ? { ...a, ...NO_AI_REVIEW } : a
      const cur = findCapture(s, a.captureId)
      if (!cur) {
        s.woundCaptures.push({
          captureId: a.captureId, patientId: a.patientId, status: hasAssessment ? 'pending_review' : 'captured',
          photoUploadFailed: a.photoUploadFailed === true, finding: w.finding, comparison: w.comparison,
          draftNote: w.draftNote, assessmentSource: a.assessmentSource, source: a.source ?? (a.device === 'director' ? 'director' : 'glasses'), capturedAtMs: now,
        })
        if (s.woundCaptures.length > MAX_WOUND_CAPTURES) s.woundCaptures.shift()
        return { ok: true }
      }
      if (cur.status === 'saved' || cur.status === 'sent') return { ok: false, conflict: true, message: `Already ${cur.status}` }
      cur.photoUploadFailed = a.photoUploadFailed === true
      if (hasAssessment) {
        cur.finding = w.finding; cur.comparison = w.comparison; cur.draftNote = w.draftNote; cur.assessmentSource = a.assessmentSource; cur.status = 'pending_review'
      }
      return { ok: true }
    }
    case 'WOUND_RETRY_UPLOAD': {
      const cur = findCapture(s, a.captureId)
      if (!cur) return { ok: false, message: 'No wound capture' }
      cur.photoUploadFailed = false
      return { ok: true }
    }
    case 'WOUND_SET_DRESSING': return setDressing(s, a.captureId, a.dressingType, a.changedAtMin, a.intervalHours, a.device, now)
    case 'WOUND_SAVE': {
      const cur = findCapture(s, a.captureId)
      if (!cur) return { ok: false, message: 'No wound capture' }
      if (cur.status === 'saved' || cur.status === 'sent') return { ok: false, conflict: true, message: `Already ${cur.status}` }
      if (cur.status !== 'pending_review') return { ok: false, message: 'Not ready for review' }
      if (a.draftNote !== undefined) cur.draftNote = a.draftNote
      cur.status = 'saved'
      return { ok: true }
    }
    case 'WOUND_SEND': {
      const cur = findCapture(s, a.captureId)
      if (!cur) return { ok: false, message: 'No wound capture' }
      if (cur.status === 'sent') return { ok: false, conflict: true, message: `Already sent to ${cur.sentTo ?? 'the doctor'}` }
      if (cur.status === 'captured') return { ok: false, message: 'Not ready for review' }
      if (cur.assessmentSource === 'unavailable') return { ok: false, message: 'No assessment to send' }
      if (a.draftNote !== undefined) cur.draftNote = a.draftNote
      const attending = patients?.patients.find(p => p.id === cur.patientId)?.attending
      cur.sentTo = typeof attending === 'string' ? attending : 'the doctor'
      cur.status = 'sent'
      s.glassesNotice = { text: `Sent to ${cur.sentTo}`, kind: 'sent', atMs: now }
      return { ok: true }
    }
    case 'DR_REPLY': {
      if (a.captureId !== undefined) {
        const cur = findCapture(s, a.captureId)
        if (!cur) return { ok: false, message: 'No wound capture' }
        if (cur.reply) return { ok: false, conflict: true, message: 'Already replied' }
        cur.reply = { from: a.from, text: a.text, atMs: now }
      }
      s.glassesNotice = { text: `${a.from}: ${a.text}`, kind: 'dr_reply', atMs: now }
      return { ok: true }
    }
    case 'SEND_TO_PHONE':
    case 'SET_GLASSES_NOTICE': {
      const n = a.type === 'SEND_TO_PHONE' ? { text: a.text, kind: 'phone' } : a.notice
      s.glassesNotice = n ? { ...n, atMs: now } : null
      return { ok: true }
    }
    case 'SET_GLASSES_VIEW':
      s.glassesViewState = a.view
      return { ok: true }
    default:
      if ((SIM_TYPES as readonly string[]).includes(a.type)) {
        if (a.type === 'SIM_CLOCK_PLUS_30') s.clockOffsetMin += 30
        if (a.type === 'SIM_ADD_CONFLICT_ORDER') {
          const pid = (a.payload as { patientId?: unknown } | undefined)?.patientId
          const target = typeof pid === 'string' ? pid : 'P-1012'
          // Without chart data no allergy check can run, so an injected order would fail open: refuse.
          if (!patients) return { ok: false, message: 'No patient data' }
          if (!patients.patients.some(p => p.id === target)) return { ok: false, message: 'Unknown patient' }
          const orders = (s.extraOrders ??= {})
          const list = Object.hasOwn(orders, target) ? orders[target] : (orders[target] = [])
          if (list.length === 0) {
            const dm = demoMinutes(s, now)
            const m = Math.floor(dm ?? 822) % 1440
            const order: ExtraOrder = {
              id: `X-${s.orderSeq = (s.orderSeq ?? 0) + 1}`, ...CONFLICT_ORDER, allergyClasses: [...CONFLICT_ORDER.allergyClasses],
              dueAt: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'),
            }
            list.push(order)
          }
        }
        if (a.type === 'SIM_DRESSING_PRESET') {
          // Demo preset only: Hydrogel, changed at the demo clock, 24 h. A Director convenience, not a recommendation.
          const cur = [...s.woundCaptures].reverse().find(c => c.status === 'captured' || c.status === 'pending_review')
          if (!cur) return { ok: false, message: 'Capture a wound photo first' }
          const dm = demoMinutes(s, now)
          return setDressing(s, cur.captureId, 'hydrogel', Math.floor(dm ?? DEFAULT_BASE_MIN) % 1440, 24, a.device, now)
        }
        if (a.type === 'SIM_FAIL_PHOTO_UPLOAD') s.photoUploadShouldFail = !s.photoUploadShouldFail
        return { ok: true }
      }
      return { ok: false, message: 'Unknown action' }
  }
}

const validMinute = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1439

/**
 * Nurse-entered dressing documentation. First-write-wins like WOUND_SAVE/SEND: once the note is saved or sent it is
 * frozen. While it is still a draft the nurse may correct it. The server never chooses an interval; it only adds.
 */
function setDressing(
  s: SessionState, captureId: string, type: DressingType, changedAtMin: number | undefined,
  intervalHours: number | null | undefined, device: WoundDressing['enteredBy'], now: number,
): Partial_ {
  const cur = findCapture(s, captureId)
  if (!cur) return { ok: false, message: 'No wound capture' }
  if (cur.status === 'sent') return { ok: false, conflict: true, message: `Already sent to ${cur.sentTo ?? 'the doctor'}` }
  if (cur.status === 'saved') return { ok: false, conflict: true, message: 'Already saved' }
  if (!(DRESSING_TYPES as readonly unknown[]).includes(type)) return { ok: false, message: 'Bad dressing type' }
  if (type === 'none') {
    cur.dressing = { type, nextDueMin: null, enteredBy: device, atMs: now }
    return { ok: true }
  }
  if (!validMinute(changedAtMin)) return { ok: false, message: 'Bad changed time' }
  if (intervalHours === undefined || !DRESSING_INTERVAL_PRESETS.includes(intervalHours)) return { ok: false, message: 'Bad interval' }
  cur.dressing = {
    type, changedAtMin, intervalHours,
    nextDueMin: intervalHours === null ? null : (changedAtMin + intervalHours * 60) % 1440,
    enteredBy: device, atMs: now,
  }
  return { ok: true }
}

const MAX_VIEW_JSON = 4000
const MAX_PAYLOAD_JSON = 2000
function finiteDeep(v: unknown, depth: number): boolean {
  if (depth > 6) return false
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.length <= 100 && v.every(x => finiteDeep(x, depth + 1))
  if (v && typeof v === 'object') return Object.values(v).every(x => finiteDeep(x, depth + 1))
  return true
}

/** Validate untrusted input into an Action, or return an error string. */
export function validateAction(raw: unknown): { action: Action } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'bad action' }
  const o = raw as Record<string, unknown>
  if (typeof o.type !== 'string') return { error: 'bad type' }
  if (typeof o.clientEventId !== 'string' || !o.clientEventId || o.clientEventId.length > 100) return { error: 'bad clientEventId' }
  if (o.device !== 'glasses' && o.device !== 'phone' && o.device !== 'director') return { error: 'bad device' }
  const known = ['START_SHIFT', 'SET_ACTIVE_PATIENT', 'LOG_MED', 'UNDO_LAST_MED', 'RESET_SESSION', 'SET_CLOCK_OFFSET',
    'WOUND_CAPTURED', 'WOUND_SAVE', 'WOUND_SEND', 'WOUND_RETRY_UPLOAD', 'WOUND_SET_DRESSING', 'DR_REPLY', 'SEND_TO_PHONE', 'SET_GLASSES_NOTICE', 'SET_GLASSES_VIEW', 'TELEMETRY_SAMPLE', 'ALLERGY_ACK', 'HANDOFF_OFFER', 'HANDOFF_READBACK', 'HANDOFF_ACCEPT', ...SIM_TYPES]
  if (!known.includes(o.type)) return { error: `unknown action type` }
  const str = (k: string) => typeof o[k] === 'string' && (o[k] as string).length <= 200
  const cid = (k: string) => typeof o[k] === 'string' && CAPTURE_ID.test(o[k] as string)
  const long = (k: string) => typeof o[k] === 'string' && (o[k] as string).length <= 2000
  const optLong = (k: string) => o[k] === undefined || long(k)
  // Bounded, finite-only JSON: no NaN/Infinity anywhere, limited size and depth.
  const sane = (v: unknown, limit: number): boolean => {
    try { return JSON.stringify(v ?? null).length <= limit && finiteDeep(v, 0) } catch { return false }
  }
  if (o.via !== undefined && !['glasses', 'phone', 'voice', 'tap'].includes(o.via as string)) return { error: 'bad via' }
  if (o.payload !== undefined && !sane(o.payload, MAX_PAYLOAD_JSON)) return { error: 'bad payload' }
  switch (o.type) {
    case 'START_SHIFT':
      if (o.baseMin !== undefined && !(typeof o.baseMin === 'number' && Number.isInteger(o.baseMin) && o.baseMin >= 0 && o.baseMin <= 1439)) return { error: 'bad baseMin' }
      break
    case 'SET_GLASSES_NOTICE': {
      const n = o.notice
      if (n !== null) {
        const t = n as { text?: unknown; kind?: unknown } | undefined
        if (!t || typeof t !== 'object' || typeof t.text !== 'string' || t.text.length > 200) return { error: 'bad notice' }
        if (t.kind !== undefined && (typeof t.kind !== 'string' || t.kind.length > 40)) return { error: 'bad notice' }
      }
      break
    }
    case 'SET_GLASSES_VIEW': if (!sane(o.view, MAX_VIEW_JSON)) return { error: 'bad view' }; break
    case 'LOG_MED':
      if (!str('patientId') || !str('medKey')) return { error: 'bad LOG_MED' }
      if (o.earlyConfirmed !== undefined && typeof o.earlyConfirmed !== 'boolean') return { error: 'bad earlyConfirmed' }
      if (o.scanLocked !== undefined && typeof o.scanLocked !== 'boolean') return { error: 'bad scanLocked' }
      if (o.allergyConfirmed !== undefined && typeof o.allergyConfirmed !== 'boolean') return { error: 'bad allergyConfirmed' }
      break
    case 'HANDOFF_OFFER':
      if (!cid('handoffId') || !cid('patientId') || !cid('toNurseId')) return { error: 'bad HANDOFF_OFFER' }
      if (o.severity !== undefined && !(SEVERITIES as readonly unknown[]).includes(o.severity)) return { error: 'bad severity' }
      break
    case 'HANDOFF_READBACK':
      if (!cid('handoffId')) return { error: 'bad handoffId' }
      if (typeof o.index !== 'number' || !Number.isInteger(o.index) || o.index < 0 || o.index > 99) return { error: 'bad index' }
      break
    case 'HANDOFF_ACCEPT': if (!cid('handoffId')) return { error: 'bad handoffId' }; break
    case 'SIM_HANDOFF_OFFER': {
      const p = (o.payload ?? {}) as Record<string, unknown>
      if (typeof p !== 'object' || p === null || Array.isArray(p)) return { error: 'bad payload' }
      for (const k of ['patientId', 'toNurseId']) if (p[k] !== undefined && !(typeof p[k] === 'string' && CAPTURE_ID.test(p[k] as string))) return { error: `bad ${k}` }
      if (p.severity !== undefined && !(SEVERITIES as readonly unknown[]).includes(p.severity)) return { error: 'bad severity' }
      break
    }
    case 'SIM_CHAOS_DROP': {
      const p = o.payload as Record<string, unknown> | undefined
      if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: 'bad payload' }
      if (typeof p.ms !== 'number' || !Number.isInteger(p.ms) || p.ms < 3000 || p.ms > 15000) return { error: 'bad ms' }
      if (p.thenDone !== undefined && typeof p.thenDone !== 'boolean') return { error: 'bad thenDone' }
      break
    }
    case 'ALLERGY_ACK':
      if (!str('patientId') || !str('medKey')) return { error: 'bad ALLERGY_ACK' }
      if (o.via !== undefined && o.via !== 'voice' && o.via !== 'tap') return { error: 'bad via' }
      break
    case 'TELEMETRY_SAMPLE':
      if (!(TELEMETRY_METRICS as readonly unknown[]).includes(o.metric)) return { error: 'bad metric' }
      if (typeof o.ms !== 'number' || !Number.isFinite(o.ms) || o.ms < 0 || o.ms > 600_000) return { error: 'bad ms' }
      break
    case 'SET_ACTIVE_PATIENT': if (o.patientId !== null && !str('patientId')) return { error: 'bad patientId' }; break
    case 'SET_CLOCK_OFFSET': if (typeof o.offsetMin !== 'number' || !Number.isFinite(o.offsetMin) || Math.abs(o.offsetMin) > 1440) return { error: 'bad offset' }; break
    case 'WOUND_CAPTURED':
      if (!cid('captureId') || !str('patientId') || !long('finding') || !long('comparison') || !long('draftNote')) return { error: 'bad WOUND_CAPTURED' }
      if (o.source !== undefined && o.source !== 'glasses' && o.source !== 'director') return { error: 'bad source' }
      if (o.assessmentSource !== undefined && o.assessmentSource !== 'gemini' && o.assessmentSource !== 'fallback' && o.assessmentSource !== 'unavailable') return { error: 'bad assessmentSource' }
      if (o.photoUploadFailed !== undefined && typeof o.photoUploadFailed !== 'boolean') return { error: 'bad photoUploadFailed' }
      break
    case 'WOUND_SAVE': case 'WOUND_SEND': if (!cid('captureId') || !optLong('draftNote')) return { error: `bad ${o.type}` }; break
    case 'WOUND_SET_DRESSING': {
      if (!cid('captureId') || !(DRESSING_TYPES as readonly unknown[]).includes(o.dressingType)) return { error: 'bad WOUND_SET_DRESSING' }
      if (o.dressingType !== 'none') {
        if (!validMinute(o.changedAtMin)) return { error: 'bad changedAtMin' }
        if (o.intervalHours === undefined || !DRESSING_INTERVAL_PRESETS.includes(o.intervalHours as number | null)) return { error: 'bad intervalHours' }
      }
      break
    }
    case 'WOUND_RETRY_UPLOAD': if (!cid('captureId')) return { error: 'bad captureId' }; break
    case 'DR_REPLY':
      if (!str('from') || !long('text') || (o.captureId !== undefined && !cid('captureId'))) return { error: 'bad DR_REPLY' }
      break
    case 'SEND_TO_PHONE': if (!str('text')) return { error: 'bad text' }; break
  }
  // `instance` is stamped by the server from the connect query; a client-supplied one is dropped.
  const { instance: _ignored, ...clean } = o
  void _ignored
  return { action: clean as unknown as Action }
}
