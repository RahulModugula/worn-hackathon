import type { Action, ActionResult, SessionState, MedStatus, WoundCapture, FeedEntry, ExtraOrder, TelemetryMetric } from '../shared/types'
import { NO_AI_REVIEW, SIM_TYPES, TELEMETRY_KEEP, TELEMETRY_METRICS } from '../shared/types'
import { ACTIONABLE_WINDOW_MIN, hhmmToMinutes, longTime, minutesUntil } from '../shared/clock'
import { CONFLICT_ORDER } from '../shared/allergy'

export const UNDO_WINDOW_MS = 10_000
export const MAX_SEEN_IDS = 200
export const MAX_SESSIONS = 50
export const DEFAULT_BASE_MIN = 822 // 1:42 PM
export const MAX_WOUND_CAPTURES = 20
export const NOT_ON_LIST = 'Not on your list'
export const MAX_FEED = 60
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
export interface PatientsData { nurse?: { assignedPatientIds?: string[] }; patients: PatientLike[] }

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
      session.events.push({ seq: ++session.eventSeq, atMs: nowMs, type: action.type, device: action.device })
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
  const chain: string[] = []
  switch (a.type) {
    case 'LOG_MED': {
      kind = 'med_given'; patientId = a.patientId
      medName = findMed(s, patients, a.patientId, a.medKey)?.name
      if (a.scanLocked === true) chain.push('Wristband matched')
      chain.push('Nurse confirmed via ' + (a.via ?? a.device))
      if (a.earlyConfirmed === true) chain.push('Early dose confirmed')
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
    case 'DR_REPLY': {
      kind = 'dr_reply'; patientId = a.captureId ? findCapture(s, a.captureId)?.patientId : undefined
      chain.push('Reply from ' + a.from)
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
    ...(medName ? { medName } : {}),
  }
  const feed = s.feed ?? (s.feed = [])
  feed.push(entry)
  if (feed.length > MAX_FEED) feed.shift()
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
      const dueAt = findMed(s, patients, a.patientId, a.medKey)?.dueAt
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
      Object.assign(s, fresh)
      s.events = []
      delete s.telemetry; delete s.feed; delete s.extraOrders // optional keys survive Object.assign
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
          if (patients && !patients.patients.some(p => p.id === target)) return { ok: false, message: 'Unknown patient' }
          const orders = (s.extraOrders ??= {})
          const list = Object.hasOwn(orders, target) ? orders[target] : (orders[target] = [])
          if (list.length === 0) {
            const dm = demoMinutes(s, now)
            const m = Math.floor(dm ?? 822) % 1440
            const order: ExtraOrder = {
              id: 'X-1', ...CONFLICT_ORDER, allergyClasses: [...CONFLICT_ORDER.allergyClasses],
              dueAt: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'),
            }
            list.push(order)
          }
        }
        if (a.type === 'SIM_FAIL_PHOTO_UPLOAD') s.photoUploadShouldFail = !s.photoUploadShouldFail
        return { ok: true }
      }
      return { ok: false, message: 'Unknown action' }
  }
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
    'WOUND_CAPTURED', 'WOUND_SAVE', 'WOUND_SEND', 'WOUND_RETRY_UPLOAD', 'DR_REPLY', 'SEND_TO_PHONE', 'SET_GLASSES_NOTICE', 'SET_GLASSES_VIEW', 'TELEMETRY_SAMPLE', ...SIM_TYPES]
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
    case 'WOUND_RETRY_UPLOAD': if (!cid('captureId')) return { error: 'bad captureId' }; break
    case 'DR_REPLY':
      if (!str('from') || !long('text') || (o.captureId !== undefined && !cid('captureId'))) return { error: 'bad DR_REPLY' }
      break
    case 'SEND_TO_PHONE': if (!str('text')) return { error: 'bad text' }; break
  }
  return { action: o as unknown as Action }
}
