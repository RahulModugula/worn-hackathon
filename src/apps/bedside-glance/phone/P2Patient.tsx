import type { SessionState } from '../../../../shared/types';
import { hhmmToMinutes, longTime } from '../../../../shared/clock';
import {
  clockLabel, deviceLabel, medGroupOf, medRows, minutesLeft, prnNextMin, relativeDue, woundDueMin, type MedGroup, type MedRow, type Patient,
} from './model';
import { Icon } from './Icon';
import { Avatar, Button, Card, DueText, EmptyState, Stat } from './ui';

/** Undo control for the last med log, from either device. `secondsLeft` 0 means the window has closed. */
export interface UndoInfo { label: string | null; secondsLeft: number; remainingMs?: number }

interface Props {
  patient: Patient | undefined;
  state: SessionState | null;
  nowMin: number | null;
  /** Logs a med from the phone. Returns the conflict copy when it was already given, else null. */
  onLogMed: (medId: string) => string | null;
  /** Shows a refusal (for example the already-given conflict) as a toast. */
  onNotice: (message: string) => void;
  onWound: () => void;
  onShift: () => void;
  hasPendingWound: boolean;
  /** Null when no med has been logged yet this shift. Used to pin the Undo countdown on the card just logged. */
  undo: UndoInfo | null;
  /** Assessment label of the newest wound photo, e.g. "No AI review". */
  woundLabel?: string;
}

const GROUPS: { id: MedGroup; title: string }[] = [
  { id: 'due', title: 'Due now' },
  { id: 'upcoming', title: 'Upcoming' },
  { id: 'given', title: 'Given' },
];

export function P2Patient({ patient, state, nowMin, onLogMed, onNotice, onWound, onShift, hasPendingWound, undo, woundLabel }: Props) {
  if (!patient) {
    return (
      <section className="ph-view" aria-labelledby="p2-empty">
        <EmptyState
          icon="user"
          title="No patient loaded"
          action={<Button variant="primary" onClick={onShift}>Choose from my shift</Button>}
        >
          Scan a wristband with the glasses, or pick a patient from your shift.
        </EmptyState>
      </section>
    );
  }

  const rows = medRows(patient, state);
  const grouped = GROUPS.map(g => ({ ...g, rows: rows.filter(r => medGroupOf(r, nowMin) === g.id).sort((a, b) => a.dueMin - b.dueMin) }));
  // Before the shift starts nothing is "due now": one plain list, still sorted by time.
  const showHeadings = nowMin !== null;
  const v = patient.vitals;
  const pinned = undo && undo.secondsLeft > 0 ? undo : null;

  const log = (medId: string) => {
    const conflict = onLogMed(medId);
    if (conflict) onNotice(conflict);
  };

  return (
    <section className="ph-view ph-view-patient" aria-labelledby="p2-title">
      <div className="ph-patient-head">
        <div className="ph-ph-id">
          <Avatar name={patient.name} size="lg" />
          <div className="ph-ph-text">
            <h1 id="p2-title" className="ph-title">{patient.name}</h1>
            <p className="ph-muted">Age {patient.age} · Rm {patient.room} · {patient.attending}</p>
          </div>
        </div>
        {patient.allergies.length > 0 ? (
          <p className="ph-allergy-bar">
            <Icon name="allergy" size={20} />
            <span>Allergy: {patient.allergies.join(', ')}</span>
          </p>
        ) : (
          <p className="ph-allergy-bar ph-allergy-none">
            <Icon name="info" size={20} />
            <span>No allergies on chart</span>
          </p>
        )}
      </div>

      {grouped.map(g => g.rows.length > 0 && (
        <div key={g.id} className="ph-group">
          {showHeadings && <h2 className="ph-h2 ph-section-title">{g.title} <span className="ph-count">{g.rows.length}</span></h2>}
          {!showHeadings && g.id === 'upcoming' && <h2 className="ph-h2 ph-section-title">Medications</h2>}
          <ul className="ph-list">
            {g.rows.map(r => <MedCard key={r.med.id} row={r} group={g.id} nowMin={nowMin} onLog={log} pinned={pinned} />)}
          </ul>
        </div>
      ))}

      {patient.prn.length > 0 && (
        <div className="ph-group">
          <h2 className="ph-h2 ph-section-title">As needed</h2>
          <ul className="ph-list">
            {patient.prn.map(p => {
              const left = minutesLeft(prnNextMin(p), nowMin);
              const ready = left !== null && left <= 0;
              return (
                <Card as="li" key={p.id} className="ph-prn">
                  <span className="ph-prn-icon"><Icon name="pill" /></span>
                  <span className="ph-prn-body">
                    <span className="ph-strong">{p.name} {p.dose}</span>
                    <span className="ph-muted">Every {p.intervalHours} h as needed</span>
                  </span>
                  {left === null ? (
                    <span className="ph-prn-when ph-muted">Start shift</span>
                  ) : ready ? (
                    <span className="ph-prn-when ph-prn-ready"><Icon name="check-circle" size={16} />Available now</span>
                  ) : (
                    <DueText mins={left} className="ph-prn-when">Next in {left} min</DueText>
                  )}
                </Card>
              );
            })}
          </ul>
        </div>
      )}

      <div className="ph-group">
        <h2 className="ph-h2 ph-section-title">Vitals</h2>
        <Card>
          <dl className="ph-stats">
            <Stat label="BP" value={v.bp} />
            <Stat label="HR" value={String(v.hr)} />
            <Stat label="Temp" value={`${v.tempF}°F`} />
            <Stat label="SpO₂" value={`${v.spo2}%`} />
          </dl>
          <p className="ph-muted ph-stat-foot">
            Taken {longTime(hhmmToMinutes(v.takenAt))} · next {longTime(hhmmToMinutes(v.nextAt))}
            {patient.diabetic && patient.glucose && (
              <> · Glucose {patient.glucose.valueMgDl} mg/dL at {longTime(hhmmToMinutes(patient.glucose.takenAt))}</>
            )}
          </p>
        </Card>
      </div>

      {patient.wound && (
        <div className="ph-group">
          <h2 className="ph-h2 ph-section-title">Wound</h2>
          <Card>
            <p className="ph-strong">{patient.wound.site}</p>
            <p className="ph-muted">
              Changed {clockLabel(hhmmToMinutes(patient.wound.lastChangedAt))} · due {clockLabel(woundDueMin(patient.wound) % 1440)}
            </p>
            <p className="ph-muted">{patient.wound.note}</p>
            {woundLabel && <p className="ph-muted" data-testid="p2-wound-source">Last photo: {woundLabel}</p>}
            {hasPendingWound && <p className="ph-pending-note"><Icon name="info" size={16} /> A new wound photo is waiting for review.</p>}
            <Button block icon="wound" onClick={onWound}>Open wound review</Button>
          </Card>
        </div>
      )}
    </section>
  );
}

function MedCard({ row, group, nowMin, onLog, pinned }: {
  row: MedRow; group: MedGroup; nowMin: number | null; onLog: (medId: string) => void; pinned: { label: string | null; secondsLeft: number } | null;
}) {
  const { med, dueMin, given } = row;
  const isGiven = group === 'given' && given;
  const mins = minutesLeft(dueMin, nowMin);
  const name = `${med.name} ${med.dose}`;
  const early = group === 'upcoming' && nowMin !== null;
  const showPin = isGiven && pinned && pinned.label === name;
  const cls = ['ph-med', isGiven ? 'ph-med-given' : group === 'due' ? 'ph-med-due' : 'ph-med-upcoming'].join(' ');

  return (
    <li>
      <button type="button" className={cls} aria-pressed={!!isGiven} onClick={() => onLog(med.id)}>
        <span className="ph-med-main">
          <span className="ph-med-name">{name}</span>
          {isGiven && given ? (
            <>
              <span className="ph-med-sub" aria-hidden="true">
                <Icon name="check-circle" size={16} />
                Given {given.givenAtLabel ?? ''} via {deviceLabel(given)}
                {showPin && <span className="ph-pin">Reversible for {pinned.secondsLeft} s</span>}
              </span>
              <span className="ph-sr-only">✓ {given.givenAtLabel ?? ''} · via {deviceLabel(given)}</span>
            </>
          ) : (
            <span className="ph-med-sub">
              {mins === null
                ? <span className="ph-when"><Icon name="clock" size={16} /><span>{longTime(dueMin)}</span></span>
                : <DueText mins={mins}>{longTime(dueMin)} · {mins < 0 ? `${-mins} min late` : mins === 0 ? 'due now' : relativeDue(mins)}</DueText>}
            </span>
          )}
        </span>
        {!isGiven && (
          <span className={early ? 'ph-log ph-log-early' : 'ph-log ph-log-primary'}>
            {early ? 'Log early' : 'Log'}
          </span>
        )}
      </button>
    </li>
  );
}
