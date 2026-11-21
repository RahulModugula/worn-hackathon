// Shared wire types for the sync contract (FRD v2.2 section 4).

export type Device = 'glasses' | 'phone' | 'director'
export const DEVICES: readonly Device[] = ['glasses', 'phone', 'director']

export type MedVia = 'glasses' | 'phone' | 'voice' | 'tap'

export interface MedStatus {
  status: 'due' | 'given'
  givenAtMs?: number
  /** Demo-clock label of when it was given, e.g. "1:45 PM". */
  givenAtLabel?: string
  via?: MedVia
  by?: Device
}

export interface LastMedLog {
  key: string
  acceptedAtMs: number
  device: Device
}

/** Wound lifecycle, server-authoritative: captured (photo only) -> pending_review (assessed) -> saved -> sent. */
export type WoundCaptureStatus = 'captured' | 'pending_review' | 'saved' | 'sent'
export type WoundSource = 'glasses' | 'director'
/** Who wrote the finding: the real model, or the fixed sample result used without a key, on timeout or offline. */
/** 'unavailable' = no photo or no assessment was possible; the text is a notice, never a clinical finding. */
/** The non-clinical text stored for any wound result that had no AI review (source 'fallback'). */
export const NO_AI_REVIEW = {
  finding: 'Photo saved. No AI review.',
  comparison: 'No AI review: no photo comparison was made.',
  draftNote: 'Wound photo taken. Nurse assessment:',
} as const
export type AssessmentSource = 'gemini' | 'fallback' | 'unavailable'

export interface WoundReply { from: string; text: string; atMs: number }

export interface WoundCapture {
  captureId: string
  patientId: string
  status: WoundCaptureStatus
  photoUploadFailed: boolean
  finding: string
  comparison: string
  draftNote: string
  source: WoundSource
  assessmentSource?: AssessmentSource
  capturedAtMs: number
  sentTo?: string
  reply?: WoundReply
}

export interface GlassesNotice {
  text: string
  kind?: string
  atMs: number
}

export interface SessionEvent {
  /** Monotonic per session; never reset, so a client acts on each event once (cursor = last seq seen). */
  seq: number
  atMs: number
  type: string
  device: Device
  detail?: unknown
}

export interface SessionState {
  id: string
  version: number
  shift: { startedAtMs: number } | null
  /** Demo clock base: minutes since midnight at shift start (822 = 1:42 PM). */
  clock: { baseMin: number; startedAtMs: number } | null
  clockOffsetMin: number
  activePatientId: string | null
  /** Keyed `${patientId}:${medKey}`. */
  medStatus: Record<string, MedStatus>
  woundCaptures: WoundCapture[]
  glassesNotice: GlassesNotice | null
  events: SessionEvent[]
  /** Seq of the newest event ever recorded. Survives RESET_SESSION. A fresh client starts its cursor here. */
  eventSeq: number
  lastMedLog: LastMedLog | null
  glassesViewState: unknown
  photoUploadShouldFail: boolean
  /** Last 20 latency samples per metric (ms), reported by glasses/phone. Cleared by RESET_SESSION. */
  telemetry?: Partial<Record<TelemetryMetric, number[]>>
  /** Synthetic orders injected by the Director (SIM_ADD_CONFLICT_ORDER), keyed by patient id. */
  extraOrders?: Record<string, ExtraOrder[]>
  /** Verification chain per med/wound event, newest last (bounded). Powers the P4 activity feed. */
  feed?: FeedEntry[]
}

export type TelemetryMetric = 'scanToCardMs' | 'doneToAckMs' | 'assessMs'
export const TELEMETRY_METRICS: readonly TelemetryMetric[] = ['scanToCardMs', 'doneToAckMs', 'assessMs']
export const TELEMETRY_KEEP = 20

export interface ExtraOrder {
  id: string
  name: string
  dose: string
  route: string
  dueAt: string
  allergyClasses?: string[]
}

export interface FeedEntry {
  seq: number
  atMs: number
  /** 'med_given' | 'med_undone' | 'wound_captured' | 'wound_saved' | 'wound_sent' | 'dr_reply' */
  kind: string
  device: Device
  patientId?: string
  patientName?: string
  room?: string
  medName?: string
  /** Demo-clock label, e.g. "2:05 PM". */
  timeLabel: string
  /** Ordered verification steps, e.g. ['Wristband matched', 'Nurse confirmed via voice', 'Server accepted']. */
  chain: string[]
}

interface Base {
  clientEventId: string
  device: Device
}

export type SimActionType =
  | 'SIM_SCAN_RM_12'
  | 'SIM_SCAN_RM_14'
  | 'SIM_VOICE_DONE'
  | 'SIM_VOICE_NEXT'
  | 'SIM_VOICE_UNDO'
  | 'SIM_TRIGGER_PAIN'
  | 'SIM_TRIGGER_WOUND'
  | 'SIM_SEND_TO_PHONE'
  | 'SIM_FAIL_PHOTO_UPLOAD'
  | 'SIM_CAPTURE_WOUND'
  | 'SIM_DR_REPLY'
  | 'SIM_ALLERGY_ALERT'
  | 'SIM_CLOCK_PLUS_30'
  | 'SIM_ADD_CONFLICT_ORDER'

export const SIM_TYPES: readonly SimActionType[] = [
  'SIM_SCAN_RM_12', 'SIM_SCAN_RM_14', 'SIM_VOICE_DONE', 'SIM_VOICE_NEXT', 'SIM_VOICE_UNDO',
  'SIM_TRIGGER_PAIN', 'SIM_TRIGGER_WOUND', 'SIM_SEND_TO_PHONE', 'SIM_FAIL_PHOTO_UPLOAD', 'SIM_CAPTURE_WOUND',
  'SIM_DR_REPLY', 'SIM_ALLERGY_ALERT', 'SIM_CLOCK_PLUS_30', 'SIM_ADD_CONFLICT_ORDER',
]

export type Action =
  | (Base & { type: 'START_SHIFT'; baseMin?: number })
  | (Base & { type: 'SET_ACTIVE_PATIENT'; patientId: string | null })
  | (Base & { type: 'LOG_MED'; patientId: string; medKey: string; via?: MedVia
      /** Nurse confirmed giving a med that is not yet actionable (due in more than 30 min). */
      earlyConfirmed?: boolean
      /** True when the glasses scan locked this patient (wristband matched); recorded in the feed chain. */
      scanLocked?: boolean })
  | (Base & { type: 'TELEMETRY_SAMPLE'; metric: TelemetryMetric; ms: number })
  | (Base & { type: 'UNDO_LAST_MED' })
  | (Base & { type: 'RESET_SESSION' })
  | (Base & { type: 'SET_CLOCK_OFFSET'; offsetMin: number })
  | (Base & {
      type: 'WOUND_CAPTURED'; captureId: string; patientId: string; photoUploadFailed?: boolean
      finding: string; comparison: string; draftNote: string; source?: WoundSource; assessmentSource?: AssessmentSource
    })
  | (Base & { type: 'WOUND_SAVE'; captureId: string; draftNote?: string })
  | (Base & { type: 'WOUND_SEND'; captureId: string; draftNote?: string })
  | (Base & { type: 'WOUND_RETRY_UPLOAD'; captureId: string })
  | (Base & { type: 'DR_REPLY'; captureId?: string; from: string; text: string })
  | (Base & { type: 'SEND_TO_PHONE'; text: string })
  | (Base & { type: 'SET_GLASSES_NOTICE'; notice: { text: string; kind?: string } | null })
  | (Base & { type: 'SET_GLASSES_VIEW'; view: unknown })
  | (Base & { type: SimActionType; payload?: unknown })

export type ActionType = Action['type']

export interface ActionResult {
  ok: boolean
  conflict?: boolean
  message?: string
  /** Authoritative state after the action. */
  state: SessionState
  /** Client should drop its local outbox (RESET_SESSION). */
  clearOutbox?: boolean
  /** LOG_MED refused because the med is not yet due; resend with earlyConfirmed:true to override. */
  needsConfirm?: boolean
}

export type ServerMsg =
  | { t: 'state'; state: SessionState }
  | { t: 'result'; clientEventId: string; result: ActionResult }
  /** Connected sockets per device role in this session. Sent on connect and on every disconnect. */
  | { t: 'presence'; presence: Record<Device, number> }
  | { t: 'pong' }
  | { t: 'error'; message: string; clientEventId?: string }
