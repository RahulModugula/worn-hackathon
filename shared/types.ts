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

/** Nurse-documented dressing choices (pick list). Documentation only: no recommendation is implied by any option. */
export const DRESSING_TYPES = ['hydrogel', 'hydrocolloid', 'foam', 'alginate', 'film', 'gauze', 'other', 'none'] as const
export type DressingType = (typeof DRESSING_TYPES)[number]
export const DRESSING_LABELS: Record<DressingType, string> = {
  hydrogel: 'Hydrogel', hydrocolloid: 'Hydrocolloid', foam: 'Foam', alginate: 'Alginate',
  film: 'Transparent film', gauze: 'Gauze', other: 'Other', none: 'None',
}
/** Interval presets the nurse can pick, in hours. `null` = "per protocol" (no next-due time is computed). Not a clinical recommendation. */
export const DRESSING_INTERVAL_PRESETS: readonly (number | null)[] = [24, 48, 72, null]

/** What the nurse entered. Server computes nextDueMin from changedAtMin + intervalHours; it never picks an interval. */
export interface WoundDressing {
  type: DressingType
  /** Minutes since midnight on the demo clock. Absent for type 'none'. */
  changedAtMin?: number
  /** Nurse-chosen preset in hours; null = per protocol. Absent for type 'none'. */
  intervalHours?: number | null
  /** Minutes since midnight (wraps at 1440); null when per protocol or none. */
  nextDueMin: number | null
  enteredBy: Device
  atMs: number
}

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
  /** Nurse-entered dressing documentation (not AI, not a recommendation). */
  dressing?: WoundDressing
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
  /** Count of injected orders; survives RESET_SESSION so an order id is never reused (a pre-reset ack cannot match a new order). */
  orderSeq?: number
  /** Verification chain per med/wound event, newest last (bounded). Powers the P4 activity feed. */
  feed?: FeedEntry[]
  /** Allergy alerts a wearer acknowledged on the glasses, so another wearer does not re-alert. Cleared by RESET_SESSION. */
  allergyAcks?: AllergyAck[]
  /** Handoff packets (newest last, capped at MAX_HANDOFFS). Cleared by RESET_SESSION. */
  handoffs?: HandoffPacket[]
}

/** I-PASS illness severity. Only ever set by a nurse's selection; never computed. */
export type Severity = 'Stable' | 'Watch' | 'Unstable'
export const SEVERITIES: readonly Severity[] = ['Stable', 'Watch', 'Unstable']
export const MAX_HANDOFFS = 10

/** One line of a handoff packet. Sections follow I-PASS: I illness severity, P patient, A action list, S situation awareness. */
export interface HandoffItem {
  section: 'I' | 'P' | 'A' | 'S'
  text: string
  /** Every allergy item and every med given in the last 4 h: the receiver must read each back before accepting. */
  critical: boolean
}

export interface HandoffPacket {
  handoffId: string
  patientId: string
  fromNurseId: string
  toNurseId: string
  severity?: Severity
  items: HandoffItem[]
  status: 'offered' | 'accepted'
  /** Server-stamped connection instance of the offering device. */
  offeredByInstance: string
  offeredVia: 'glasses' | 'phone'
  /** Demo-clock label of the offer, e.g. "2:05 PM". */
  createdLabel: string
  /** Indexes into `items` the receiver read back (critical items only). */
  readBack: number[]
  acceptedAtMs?: number
  acceptedLabel?: string
  acceptedByInstance?: string
}

export const MAX_ALLERGY_ACKS = 20
export interface AllergyAck {
  /** `${patientId}:${medKey}` */
  key: string
  atMs: number
  /** Demo-clock label of the acknowledgement, e.g. "1:42 PM". */
  label: string
  device: Device
  via: 'voice' | 'tap'
}

export type TelemetryMetric = 'scanToCardMs' | 'doneToAckMs' | 'assessMs' | 'outboxQueuedMs'
export const TELEMETRY_METRICS: readonly TelemetryMetric[] = ['scanToCardMs', 'doneToAckMs', 'assessMs', 'outboxQueuedMs']
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
  /** 'med_given' | 'med_undone' | 'wound_captured' | 'wound_saved' | 'wound_sent' | 'wound_dressing' | 'dr_reply' | 'allergy_ack' | 'handoff_offered' | 'handoff_accepted' */
  kind: string
  device: Device
  patientId?: string
  patientName?: string
  room?: string
  medName?: string
  /** Demo-clock label, e.g. "2:05 PM". */
  timeLabel: string
  /** Short free text for handoff entries, e.g. "Priya S. to Marcus T.". */
  label?: string
  /** Ordered verification steps, e.g. ['Wristband matched', 'Nurse confirmed via voice', 'Server accepted']. */
  chain: string[]
}

interface Base {
  clientEventId: string
  device: Device
  /**
   * Opaque id of the connection's browser tab or app instance. Set by the SERVER from the WS connect query
   * (`instance=`, uuid-shaped, at most 64 chars); an `instance` in a frame body is ignored.
   */
  instance?: string
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
  | 'SIM_DRESSING_PRESET'
  | 'SIM_HANDOFF_OFFER'
  | 'SIM_CHAOS_DROP'

export const SIM_TYPES: readonly SimActionType[] = [
  'SIM_SCAN_RM_12', 'SIM_SCAN_RM_14', 'SIM_VOICE_DONE', 'SIM_VOICE_NEXT', 'SIM_VOICE_UNDO',
  'SIM_TRIGGER_PAIN', 'SIM_TRIGGER_WOUND', 'SIM_SEND_TO_PHONE', 'SIM_FAIL_PHOTO_UPLOAD', 'SIM_CAPTURE_WOUND',
  'SIM_DR_REPLY', 'SIM_ALLERGY_ALERT', 'SIM_CLOCK_PLUS_30', 'SIM_ADD_CONFLICT_ORDER',
  'SIM_DRESSING_PRESET',
  'SIM_HANDOFF_OFFER', 'SIM_CHAOS_DROP',
]

export type Action =
  | (Base & { type: 'START_SHIFT'; baseMin?: number })
  | (Base & { type: 'SET_ACTIVE_PATIENT'; patientId: string | null })
  | (Base & { type: 'LOG_MED'; patientId: string; medKey: string; via?: MedVia
      /** Nurse confirmed giving a med that is not yet actionable (due in more than 30 min). */
      earlyConfirmed?: boolean
      /** Nurse confirmed giving a med whose class matches a chart allergy. The glasses never send this (confirm on phone). */
      allergyConfirmed?: boolean
      /** True when the glasses scan locked this patient (wristband matched); recorded in the feed chain. */
      scanLocked?: boolean })
  | (Base & { type: 'ALLERGY_ACK'; patientId: string; medKey: string; via?: 'voice' | 'tap' })
  | (Base & { type: 'HANDOFF_OFFER'; handoffId: string; patientId: string; toNurseId: string; severity?: Severity })
  | (Base & { type: 'HANDOFF_READBACK'; handoffId: string; index: number })
  | (Base & { type: 'HANDOFF_ACCEPT'; handoffId: string })
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
  | (Base & { type: 'WOUND_SET_DRESSING'; captureId: string; dressingType: DressingType; changedAtMin?: number; intervalHours?: number | null })
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
  /** LOG_MED refused because the med is not yet due (earlyConfirmed:true overrides) or conflicts with a chart allergy (allergyConfirmed:true overrides). */
  needsConfirm?: boolean
}

/** What the server knows about one connected (or just dropped) device, from its pings. */
export interface PeerStats {
  device: Device
  instance?: string
  /** The `state.version` the peer last reported; null until its first ping. */
  v: number | null
  /** Actions waiting in the peer's outbox. */
  q: number
  /** Round trip of the peer's last ping/pong, measured by the peer (ms). */
  rttMs: number | null
  /** Server time of the peer's last ping. */
  lastSeenMs: number
  /** Server time the socket dropped; null while connected. */
  offlineSince: number | null
  /** How long the peer's last outage lasted, as it reported on reconnect (ms). */
  lastOfflineMs: number | null
}

export type ServerMsg =
  | { t: 'state'; state: SessionState }
  | { t: 'result'; clientEventId: string; result: ActionResult }
  /** Connected sockets per device role in this session. Sent on connect and on every disconnect. */
  | { t: 'presence'; presence: Record<Device, number> }
  /** Answer to a ping; `n` echoes the ping's sequence number so the client can time the round trip. */
  | { t: 'pong'; n?: number }
  /** Director-only sync health: one entry per socket (and recently dropped instances), plus the server's state version. At most 2 per second. */
  | { t: 'stats'; peers: PeerStats[]; serverVersion: number }
  | { t: 'error'; message: string; clientEventId?: string }
