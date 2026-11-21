import { useEffect, useRef, useState } from 'react';
import { demoMinutes, hhmmToMinutes, longTime } from '../../../../shared/clock';
import { P1Shift } from './P1Shift';
import { P2Patient } from './P2Patient';
import { P3WoundReview, WoundEmpty } from './P3WoundReview';
import { P4ActivityFeed } from './P4ActivityFeed';
import { DirectorDrawer, DirectorHandle } from './DirectorDrawer';
import { ScanTalk } from './ScanTalk';
import { useBedsideSession } from './useBedsideSession';
import { Icon } from './Icon';
import { BrandMark, Button, Sheet, StatusDot, TabBar, Toast, UndoRing, type TabItem } from './ui';
import {
  EARLY_REASONS, NURSE, assessmentLabel, captureAssessment, conflictText, isNotYetDue, medStatusOf, patientById, pendingReview,
  sortedPatients, latestCapture, undoLabel, undoRemainingSinceReceipt, withDressingLine,
} from './model';
import './tokens.css';
import './phone.css';

export interface PhoneAppProps {
  sessionId?: string;
  /** `?director=1` opens the Director Drawer on load. */
  directorOpen?: boolean;
  /** `?scan=1` opens Scan & Talk (Plan B) on load. */
  scanOpen?: boolean;
}

type View = { name: 'shift' } | { name: 'patient'; patientId: string | null } | { name: 'wound' } | { name: 'activity' } | { name: 'scan' };

/** A med that is not yet due, waiting for the nurse to confirm giving it. */
interface EarlyConfirm { patientId: string; medId: string; label: string; timeLabel: string }

/** Ticks once a second so the clock, countdowns and the Undo window stay live. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PhoneApp({ sessionId = 'demo', directorOpen = false, scanOpen = false }: PhoneAppProps) {
  // Director capability is requested on the socket once the drawer is enabled (?director=1 or the bolt) and kept.
  const [directorEnabled, setDirectorEnabled] = useState(directorOpen);
  const session = useBedsideSession(sessionId, { director: directorEnabled });
  const { state, offline, forceOffline, send, setForceOffline } = session;
  const nowMs = useNow(1000);

  const [view, setView] = useState<View>(scanOpen ? { name: 'scan' } : { name: 'shift' });
  const [drawerOpen, setDrawerOpen] = useState(directorOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const [early, setEarly] = useState<EarlyConfirm | null>(null);
  const [lastPatient, setLastPatient] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const started = !!state?.shift;
  const nowMin = state?.shift ? demoMinutes(state.shift.startedAtMs, nowMs, state.clockOffsetMin) : null;

  // Glasses lock a patient: P2 opens. Local phone taps never change activePatientId, so they do not trigger this.
  const activeId = state?.activePatientId ?? null;
  const lastActive = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (activeId === lastActive.current) return;
    lastActive.current = activeId;
    if (activeId) { setView({ name: 'patient', patientId: activeId }); setLastPatient(activeId); }
  }, [activeId]);

  // A new wound capture awaiting review opens P3.
  const pending = pendingReview(state);
  const pendingKey = pending ? pending.captureId : null;
  const lastPending = useRef<string | null>(null);
  useEffect(() => {
    if (pendingKey && pendingKey !== lastPending.current) setView({ name: 'wound' });
    lastPending.current = pendingKey;
  }, [pendingKey]);

  const labelFor = (atMs: number) => {
    const shift = state?.shift;
    return shift ? longTime(demoMinutes(shift.startedAtMs, atMs, state.clockOffsetMin)) : '';
  };

  // One place for every med log (P2 and Scan & Talk): already given, not yet due (confirm first), or send.
  const logMed = (patientId: string, medId: string): string | null => {
    const existing = medStatusOf(state, patientId, medId);
    if (existing?.status === 'given') return conflictText(existing);
    const patient = patientById(patientId);
    const med = patient?.meds.find(m => m.id === medId);
    if (patient && med) {
      const dueMin = hhmmToMinutes(med.dueAt);
      if (isNotYetDue(dueMin, nowMin)) {
        setEarly({ patientId, medId, label: `${med.name} ${med.dose}`, timeLabel: longTime(dueMin) });
        return null;
      }
    }
    send({ type: 'LOG_MED', device: 'phone', patientId, medKey: medId, via: 'phone' });
    return null;
  };

  const confirmEarly = () => {
    if (!early) return;
    // earlyConfirmed is only ever sent after the nurse says so on this sheet.
    send({ type: 'LOG_MED', device: 'phone', patientId: early.patientId, medKey: early.medId, via: 'phone', earlyConfirmed: true });
    setEarly(null);
  };

  // Undo: the server enforces the 10 s window; this only shows the countdown and disables the button.
  const lastLog = state?.lastMedLog ?? null;
  // Phone-clock receipt time per log: the server's acceptedAtMs is never compared with this phone's clock.
  const receipts = useRef(new Map<string, number>());
  const receiptOf = (log: { key: string; acceptedAtMs: number }) => {
    const id = `${log.key}@${log.acceptedAtMs}`;
    let at = receipts.current.get(id);
    if (at === undefined) { at = Date.now(); receipts.current.clear(); receipts.current.set(id, at); }
    return at;
  };
  const undoMs = lastLog ? undoRemainingSinceReceipt(receiptOf(lastLog), nowMs) : 0;
  const undo = lastLog ? { label: undoLabel(lastLog), secondsLeft: Math.ceil(undoMs / 1000), remainingMs: undoMs } : null;
  const onUndo = () => send({ type: 'UNDO_LAST_MED', device: 'phone' });

  // Acknowledgements: every action the server refused (first-write-wins, "Too late to undo", ...) is toasted live.
  // Conflicts queued while offline arrive through session.conflicts instead.
  const { clearConflicts, lastResult } = session;
  const [dismissedSeq, setDismissedSeq] = useState(0);
  const failure = lastResult && !lastResult.ok && lastResult.message && lastResult.seq > dismissedSeq ? lastResult : null;
  const serverConflict = failure?.message ?? session.conflicts.at(-1)?.message ?? null;
  useEffect(() => {
    if (!serverConflict) return;
    const id = setTimeout(() => { clearConflicts(); if (failure) setDismissedSeq(failure.seq); }, 4000);
    return () => clearTimeout(id);
  }, [serverConflict, failure, clearConflicts]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const wound = latestCapture(state);
  const woundPatient = wound ? patientById(wound.patientId) : undefined;
  const woundAssessment = wound ? captureAssessment(wound) : null;
  const woundKey = wound ? wound.captureId : '';
  const draftText = draft && draft.key === woundKey ? draft.text : woundAssessment?.draftNote ?? '';
  // Presence comes from the server (sockets per role), not from whether the glasses have pushed a view.
  const glassesConnected = (session.presence?.glasses ?? 0) > 0;

  // The server owns the lifecycle: save, send, the "Sent to" notice on the glasses and the doctor reply timer.
  const onSaveWound = () => {
    if (!wound) return;
    send({ type: 'WOUND_SAVE', device: 'phone', captureId: wound.captureId, draftNote: withDressingLine(draftText, wound.dressing) });
  };
  const onRetryPhoto = () => {
    if (!wound) return;
    send({ type: 'WOUND_RETRY_UPLOAD', device: 'phone', captureId: wound.captureId });
  };
  const onSendWound = () => {
    if (!wound) return;
    send({ type: 'WOUND_SEND', device: 'phone', captureId: wound.captureId, draftNote: withDressingLine(draftText, wound.dressing) });
  };

  const rows = sortedPatients(state);
  const patient = view.name === 'patient' ? patientById(view.patientId) : undefined;
  // The wound label for a patient: only once an assessment exists (a waiting photo has no label yet).
  const woundLabelFor = (patientId: string): string | undefined =>
    wound && wound.patientId === patientId && woundAssessment ? assessmentLabel(woundAssessment.source) : undefined;

  const openPatient = (patientId: string) => { setLastPatient(patientId); setView({ name: 'patient', patientId }); };
  const patientId = view.name === 'patient' ? view.patientId : null;

  let body;
  if (view.name === 'scan') {
    body = (
      <ScanTalk
        state={state}
        nowMin={nowMin}
        send={send}
        logMed={logMed}
        undo={undo}
        onUndo={onUndo}
        onClose={() => setView({ name: 'shift' })}
        onWound={() => setView({ name: 'wound' })}
        hasPendingWound={!!pending}
      />
    );
  } else if (view.name === 'patient') {
    body = (
      <P2Patient
        patient={patientById(patientId)}
        state={state}
        nowMin={nowMin}
        onLogMed={medId => logMed(patientId!, medId)}
        onNotice={setNotice}
        onShift={() => setView({ name: 'shift' })}
        onWound={() => setView({ name: 'wound' })}
        hasPendingWound={!!pending && pending.patientId === patientId}
        undo={undo}
        woundLabel={patientId ? woundLabelFor(patientId) : undefined}
      />
    );
  } else if (view.name === 'wound') {
    body = wound && woundPatient ? (
      <P3WoundReview
        patient={woundPatient}
        capture={wound}
        assessment={woundAssessment}
        status={wound.status}
        capturedLabel={labelFor(wound.capturedAtMs) || '—'}
        draft={draftText}
        onDraftChange={text => setDraft({ key: woundKey, text })}
        onSave={onSaveWound}
        onSend={onSendWound}
        onRetry={onRetryPhoto}
        reply={wound.reply ?? null}
        nowMin={nowMin}
        onSetDressing={v => send({ type: 'WOUND_SET_DRESSING', device: 'phone', captureId: wound.captureId, ...v })}
      />
    ) : <WoundEmpty />;
  } else if (view.name === 'activity') {
    body = <P4ActivityFeed events={state?.events ?? []} labelFor={labelFor} feed={state?.feed} />;
  } else {
    body = (
      <P1Shift
        nurseName={NURSE.name}
        nowMin={nowMin}
        started={started}
        rows={rows}
        loading={state === null && !offline}
        unreachable={state === null && offline}
        onStart={() => send({ type: 'START_SHIFT', device: 'phone' })}
        onOpen={openPatient}
        onHelp={() => setHelpOpen(true)}
        onScanTalk={() => setView({ name: 'scan' })}
        director={directorEnabled}
      />
    );
  }

  const tabs: TabItem[] = [
    { id: 'shift', label: 'Shift', icon: 'clock' },
    { id: 'patient', label: 'Patient', icon: 'user' },
    { id: 'wound', label: 'Wound', icon: 'wound', badge: pending ? 'Review pending' : undefined },
    { id: 'activity', label: 'Activity', icon: 'activity' },
  ];
  const onTab = (id: string) => {
    if (id === 'patient') setView({ name: 'patient', patientId: view.name === 'patient' ? view.patientId : activeId ?? lastPatient });
    else setView({ name: id } as View);
  };
  const scanning = view.name === 'scan';
  const openDirector = () => { setDirectorEnabled(true); setDrawerOpen(true); };
  const brandTaps = useRef<number[]>([]);
  const onBrandTap = () => {
    const now = Date.now();
    brandTaps.current = [...brandTaps.current.filter(t => now - t < 1200), now];
    if (brandTaps.current.length >= 3) { brandTaps.current = []; openDirector(); }
  };
  const photoFailed = !!wound && wound.photoUploadFailed && wound.status === 'captured' && view.name !== 'wound';
  const toastNotice = serverConflict ?? notice;

  return (
    <div className={scanning ? 'ph-app ph-app-scan' : 'ph-app'} data-testid="phone-app">
      <header className="ph-top">
        {/* Three quick taps on the brand open the Director Drawer when the bolt is hidden (no ?director=1). */}
        <button type="button" className="ph-brand" onClick={onBrandTap} aria-label="Bedside Glance">
          <BrandMark />
          <span className="ph-wordmark">Bedside Glance</span>
        </button>
        <div className="ph-top-chips">
          <p role="status" className={offline ? 'ph-chip ph-tone-warn' : 'ph-chip ph-tone-accent'}>
            <StatusDot tone={offline ? 'warn' : 'accent'} hollow={offline} />
            {offline ? 'Reconnecting…' : <>Connected<span className="ph-sr-only"> to demo session</span></>}
          </p>
          <p className={glassesConnected ? 'ph-chip ph-tone-accent' : 'ph-chip ph-tone-neutral'}>
            <Icon name="glasses" size={16} />
            <span aria-hidden="true">{glassesConnected ? 'Glasses on' : 'No glasses'}</span>
            <span className="ph-sr-only">{glassesConnected ? 'Glasses connected' : 'Not connected'}</span>
          </p>
          {directorOpen && <DirectorHandle onOpen={openDirector} />}
        </div>
      </header>

      {pending && view.name !== 'wound' && !scanning && (
        <button type="button" className="ph-banner-sticky" onClick={() => setView({ name: 'wound' })}>
          <Icon name="wound" size={20} />
          <span>Wound photo ready for review · Open</span>
        </button>
      )}

      <main className="ph-main">{body}</main>

      <div className="ph-toast-layer">
        {photoFailed && <Toast role="alert">Photo didn&apos;t upload</Toast>}
        {toastNotice && <Toast role="alert">{toastNotice}</Toast>}
        {!scanning && lastLog && <UndoToast key={lastLog.acceptedAtMs} undo={undo!} onUndo={onUndo} />}
      </div>

      {!scanning && <TabBar items={tabs} active={view.name} onSelect={onTab} />}

      {early && <EarlySheet early={early} onConfirm={confirmEarly} onCancel={() => setEarly(null)} />}

      <DirectorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onReset={() => setView({ name: 'shift' })}
        send={send}
        forceOffline={forceOffline}
        setForceOffline={setForceOffline}
        photoFail={state?.photoUploadShouldFail === true}
        facts={{
          sessionId,
          connected: !offline,
          presence: session.presence ?? {},
          directorSelf: directorEnabled,
          telemetry: state?.telemetry,
        }}
      />

      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/** Undo toast with a 10 s ring. The ring is driven by the server's acceptedAtMs; the server enforces the window. */
function UndoToast({ undo, onUndo }: { undo: { label: string | null; secondsLeft: number; remainingMs?: number }; onUndo: () => void }) {
  const open = undo.secondsLeft > 0;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setGone(true), 4000);
    return () => clearTimeout(id);
  }, [open]);
  if (gone) return null;
  return (
    <button
      type="button"
      className={open ? 'ph-undo' : 'ph-undo ph-undo-closed'}
      onClick={onUndo}
      disabled={!open}
      aria-label={open ? `Undo ${undo.label ?? 'last med'}` : undefined}
    >
      {open ? (
        <>
          <span className="ph-undo-text">
            <span className="ph-strong">Undo</span>
            <span>{undo.label ?? 'Last med'} logged</span>
          </span>
          <UndoRing remainingMs={undo.remainingMs ?? undo.secondsLeft * 1000} secondsLeft={undo.secondsLeft} />
          <Icon name="undo" size={20} />
        </>
      ) : (
        <>
          <Icon name="check-circle" size={20} />
          <span>Undo window closed (10 s)</span>
        </>
      )}
    </button>
  );
}

/** Confirm before giving a med outside its window. A reason is required: every override has one. */
function EarlySheet({ early, onConfirm, onCancel }: { early: EarlyConfirm; onConfirm: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  return (
    <Sheet title={early.label} titleId="early-title" onClose={onCancel} hideClose>
      <p className="ph-strong ph-early-q">Not due until {early.timeLabel}. Give anyway?</p>
      <fieldset className="ph-reasons">
        <legend className="ph-label-sm">Reason</legend>
        {EARLY_REASONS.map(r => (
          <label key={r} className={reason === r ? 'ph-reason ph-reason-on' : 'ph-reason'}>
            <input type="radio" name="early-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            <span>{r}</span>
          </label>
        ))}
      </fieldset>
      <div className="ph-stack">
        <Button variant="primary" block disabled={!reason} onClick={onConfirm}>Give anyway</Button>
        <Button block onClick={onCancel}>Cancel</Button>
      </div>
    </Sheet>
  );
}

const HELP_STEPS = [
  'Tap Start Shift on the Shift tab. The demo clock starts at 1:42 PM.',
  'Scan the wristband with the glasses. Or open Director (tap the Bedside Glance logo three times) and tap Sim Scan Rm 12.',
  'The patient opens here. Tap a med to log it, or say "done" on the glasses.',
  'Say "wound" on the glasses to take a photo. Review it on the Wound tab and tap Send to the doctor.',
  'No glasses? Tap Scan & Talk on the Shift tab. The phone camera reads the wristband and the big buttons do the rest.',
  'When finished, open Director and tap RESET DEMO, then confirm.',
];

function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How to run the demo" titleId="help-title" onClose={onClose}>
      <ol className="ph-help-steps">
        {HELP_STEPS.map(s => <li key={s}>{s}</li>)}
      </ol>
      <p className="ph-muted">Synthetic patients only. Doctor replies are simulated.</p>
    </Sheet>
  );
}
