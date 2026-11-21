import { countdownText, isNotYetDue, minutesLeft, relativeDue, type MedRow, type Patient } from './model';
import { longTime } from '../../../../shared/clock';
import { Icon } from './Icon';
import { Avatar, Button, Chip, DueText, EmptyState, Skeleton } from './ui';

export interface PatientRow { patient: Patient; next: MedRow | null }

interface Props {
  nurseName: string;
  nowMin: number | null;
  started: boolean;
  rows: PatientRow[];
  /** True until the first session snapshot arrives. */
  loading?: boolean;
  /** True when the first snapshot has not arrived and the socket is down. */
  unreachable?: boolean;
  onStart: () => void;
  onOpen: (patientId: string) => void;
  onHelp: () => void;
  /** Plan B: phone camera scans the wristband and the phone shows the big buttons. */
  onScanTalk: () => void;
  /** Director mode (?director=1): the clock gets its 'Demo clock' label. */
  director?: boolean;
}

export function P1Shift({ nurseName, nowMin, started, rows, loading, unreachable, onStart, onOpen, onHelp, onScanTalk, director }: Props) {
  const clock = nowMin === null ? '--:--' : longTime(nowMin);
  const count = rows.length;

  return (
    <section className="ph-view" aria-labelledby="p1-title">
      <div className="ph-greet">
        <div className="ph-greet-text">
          <h1 id="p1-title" className="ph-title">{nurseName}</h1>
          <p className="ph-muted">{count} {count === 1 ? 'patient' : 'patients'} assigned</p>
        </div>
        <div className="ph-greet-side">
          <p className="ph-clock" role="timer" aria-label="Demo clock">
            {director && <span className="ph-label-sm">Demo clock</span>}
            <span className="ph-clock-time">{clock}</span>
          </p>
          <button type="button" className="ph-icon-btn" aria-label="Help" onClick={onHelp}><Icon name="help" /></button>
        </div>
      </div>

      {started ? (
        <p className="ph-started"><Icon name="check-circle" size={20} /><span>Shift started</span></p>
      ) : (
        <div className="ph-start-card">
          <Button variant="primary" block className="ph-btn-hero" onClick={onStart}>Start Shift</Button>
          <p className="ph-muted ph-note">Starts the demo clock at 1:42 PM.</p>
        </div>
      )}

      <button type="button" className="ph-row-btn" onClick={onScanTalk}>
        <span className="ph-row-btn-icon"><Icon name="scan" /></span>
        <span className="ph-row-btn-text">
          <span className="ph-strong">Scan &amp; Talk (glasses off)</span>
          <span className="ph-muted">Use this phone to read the wristband</span>
        </span>
        <Icon name="chevron" size={20} />
      </button>

      <h2 className="ph-h2 ph-section-title">Patients <span className="ph-muted ph-section-sub">soonest due first</span></h2>
      {unreachable ? (
        <EmptyState icon="wifi-off" title="Can't reach the demo server">
          Check that this phone is on the same network. The page reconnects by itself and keeps your taps.
        </EmptyState>
      ) : loading ? (
        <ul className="ph-list" aria-label="Loading patients">
          {[0, 1].map(i => (
            <li key={i} className="ph-card ph-skel-card">
              <Skeleton height={44} width="44px" />
              <div className="ph-skel-lines"><Skeleton height={16} width="55%" /><Skeleton height={12} width="80%" /></div>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState icon="user" title="No patients assigned">Ask the charge nurse to assign your list, then reopen this page.</EmptyState>
      ) : (
        <ul className="ph-list">
          {rows.map(({ patient, next }, idx) => {
            const mins = next ? minutesLeft(next.dueMin, nowMin) : null;
            const due = next !== null && nowMin !== null && !isNotYetDue(next.dueMin, nowMin);
            const lead = idx === 0 && next !== null;
            return (
              <li key={patient.id}>
                <button type="button" className={lead ? 'ph-patient-row ph-patient-lead' : 'ph-patient-row'} onClick={() => onOpen(patient.id)}>
                  <Avatar name={patient.name} />
                  <span className="ph-pr-body">
                    <span className="ph-pr-top">
                      <span className="ph-strong ph-pr-name">{patient.name}</span>
                      <span className="ph-muted ph-pr-room">Rm {patient.room}</span>
                    </span>
                    <span className="ph-pr-next">
                      {next ? (
                        <>
                          <span className="ph-pr-med"><Icon name="pill" size={16} />{next.med.name} {next.med.dose}</span>
                          <DueText mins={mins}>
                            <span className="ph-sr-only">{countdownText(mins)}. </span>
                            <span aria-hidden="true">{nowMin === null ? 'Start shift' : due ? `Due ${relativeDue(mins)}` : relativeDue(mins)}</span>
                          </DueText>
                        </>
                      ) : (
                        <span className="ph-pr-med"><Icon name="check-circle" size={16} />All meds given</span>
                      )}
                    </span>
                    {patient.allergies.length > 0 && (
                      <span className="ph-chips">
                        {patient.allergies.map(a => <Chip key={a} tone="warn" icon="allergy">Allergy: {a}</Chip>)}
                      </span>
                    )}
                  </span>
                  <Icon name="chevron" size={20} className="ph-chev" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
