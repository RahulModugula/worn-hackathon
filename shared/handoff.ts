// I-PASS handoff packet builder (FRD v2.2 section 4). Pure and deterministic: no clock, no randomness, NO LLM.
// Illness severity is never computed: it is "Not stated" unless the nurse selected Stable / Watch / Unstable.
// The final S of I-PASS (synthesis by the receiver) is the read-back of the critical items, tracked on the packet.
import { hhmmToMinutes, longTime } from './clock'
import { checkAllergy } from './allergy'
import type { ExtraOrder, FeedEntry, HandoffItem, MedStatus, Severity } from './types'

/** Meds due within this many demo minutes (and anything overdue and ungiven) go on the action list. */
export const HANDOFF_WINDOW_MIN = 240

export interface HandoffMed { id: string; name: string; dose?: string; dueAt: string; allergyClasses?: string[] }
export interface HandoffPatient {
  id: string
  name: string
  room: string
  attending?: string
  allergies?: readonly string[]
  meds?: readonly HandoffMed[]
  prn?: readonly { id: string; name: string; dose?: string; lastGivenAt: string; intervalHours: number }[]
  wound?: { lastChangedAt: string; intervalHours: number } | null
}
/** Structural subset of WoundCapture, so a capture that also carries `dressing` documentation is accepted as is. */
export interface HandoffCaptureLike { patientId: string; dressing?: { type: string; nextDueMin: number | null } }
export interface HandoffStateLike {
  medStatus: Record<string, Pick<MedStatus, 'status'>>
  woundCaptures: readonly HandoffCaptureLike[]
  feed?: readonly FeedEntry[]
}

/** Signed minutes from `nowMin` to `atMin` on a 24 h clock, in [-720, 719]: negative = already past. */
function delta(atMin: number, nowMin: number): number {
  return ((((atMin - nowMin) % 1440) + 1440 + 720) % 1440) - 720
}

const label = (m: number): string => longTime(((m % 1440) + 1440) % 1440)
const medText = (m: { name: string; dose?: string }): string => [m.name, m.dose].filter(Boolean).join(' ')

/** "1:30 PM" -> minutes since midnight, or null when it is not a demo-clock label. */
function parseLabel(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(s)
  if (!m) return null
  return (Number(m[1]) % 12) * 60 + Number(m[2]) + (m[3] === 'PM' ? 720 : 0)
}

export function buildHandoff(
  state: HandoffStateLike, patient: HandoffPatient, extraOrders: readonly ExtraOrder[], nowMin: number, severity?: Severity,
): HandoffItem[] {
  const now = Math.floor(nowMin)
  const items: HandoffItem[] = []
  const add = (section: HandoffItem['section'], text: string, critical = false) => items.push({ section, text, critical })

  // I: illness severity, only ever the nurse's own selection.
  add('I', `Illness severity: ${severity ?? 'Not stated'}`)

  // P: patient.
  add('P', `${patient.name} · Rm ${patient.room}`)
  const allergies = patient.allergies ?? []
  if (allergies.length > 0) add('P', `Allergies: ${allergies.join(', ')}`, true)
  else add('P', 'No allergies on chart')
  if (patient.attending) add('P', `Attending: ${patient.attending}`)

  // A: action list.
  const meds: HandoffMed[] = [...(patient.meds ?? []), ...extraOrders]
  const open = meds
    .filter((m) => state.medStatus[`${patient.id}:${m.id}`]?.status !== 'given')
    .map((m) => ({ m, d: delta(hhmmToMinutes(m.dueAt), now) }))
    .filter((x) => x.d <= HANDOFF_WINDOW_MIN)
    .sort((a, b) => a.d - b.d)
  for (const { m, d } of open) {
    const hit = checkAllergy({ allergies }, { name: m.name, dose: m.dose, allergyClasses: m.allergyClasses })
    const when = d < 0 ? `overdue since ${label(hhmmToMinutes(m.dueAt))}` : `due ${label(hhmmToMinutes(m.dueAt))}`
    add('A', `${medText(m)} ${when}${hit ? ` · Chart lists ${hit.allergy} allergy` : ''}`, hit !== null)
  }
  for (const r of patient.prn ?? []) {
    const eligible = hhmmToMinutes(r.lastGivenAt) + r.intervalHours * 60
    add('A', `${medText(r)} PRN eligible ${delta(eligible, now) <= 0 ? 'now' : label(eligible)}`)
  }
  const documented = [...state.woundCaptures].reverse().find((c) => c.patientId === patient.id && c.dressing && c.dressing.type !== 'none')
  if (documented?.dressing) {
    const d = documented.dressing
    add('A', d.nextDueMin === null ? `Dressing (${d.type}) per protocol` : `Dressing (${d.type}) due ${label(d.nextDueMin)}`)
  } else if (patient.wound) {
    add('A', `Dressing due ${label(hhmmToMinutes(patient.wound.lastChangedAt) + patient.wound.intervalHours * 60)} (chart)`)
  }

  // S: situation awareness, from the activity feed in order. An undo cancels the latest matching give.
  const given: FeedEntry[] = []
  const other: FeedEntry[] = []
  for (const f of state.feed ?? []) {
    if (f.patientId !== patient.id) continue
    if (f.kind === 'med_given') given.push(f)
    else if (f.kind === 'med_undone') {
      for (let i = given.length - 1; i >= 0; i--) if (given[i].medName === f.medName) { given.splice(i, 1); break }
    } else if (f.kind === 'allergy_ack' || f.kind === 'wound_sent' || f.kind === 'dr_reply' || f.kind === 'wound_captured') other.push(f)
  }
  const recent = (f: FeedEntry): boolean => {
    const m = parseLabel(f.timeLabel)
    return m !== null && delta(m, now) <= 0 && delta(m, now) >= -HANDOFF_WINDOW_MIN
  }
  for (const f of given) {
    const via = f.chain.map((c) => /^Nurse confirmed via (.+)$/.exec(c)?.[1]).find(Boolean) ?? 'unknown'
    add('S', `${f.medName ?? 'Med'} given ${f.timeLabel} via ${via}`, recent(f))
  }
  for (const f of other) {
    const to = f.chain.map((c) => /^Sent to (.+)$/.exec(c)?.[1]).find(Boolean)
    const from = f.chain.map((c) => /^Reply from (.+)$/.exec(c)?.[1]).find(Boolean)
    if (f.kind === 'allergy_ack') add('S', `Allergy alert acknowledged ${f.timeLabel}: ${f.medName ?? 'order'} · ${f.chain[1] ?? 'Chart lists an allergy'}`, true)
    else if (f.kind === 'wound_sent') add('S', `Wound photo sent to ${to ?? 'the doctor'} ${f.timeLabel}`)
    else if (f.kind === 'dr_reply') add('S', `Reply from ${from ?? 'the doctor'} ${f.timeLabel}`)
    else add('S', `Wound photo captured ${f.timeLabel}`)
  }
  return items
}

/** Indexes of the items the receiver must read back before accepting. */
export function criticalIndexes(items: readonly HandoffItem[]): number[] {
  return items.flatMap((i, n) => (i.critical ? [n] : []))
}
