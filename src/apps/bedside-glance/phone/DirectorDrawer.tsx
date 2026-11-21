import { useState } from 'react';
import type { SessionState, SimActionType } from '../../../../shared/types';
import { PATIENTS, type Send } from './model';
import { Preflight } from './Preflight';
import { Icon } from './Icon';
import { Button, Sheet } from './ui';

export interface DirectorContext {
  send: Send;
  forceOffline: boolean;
  setForceOffline: (v: boolean) => void;
  /** Session flag photoUploadShouldFail: the toggle button shows it. */
  photoFail?: boolean;
}

export type DirectorGroup = 'Scenario' | 'Voice and input' | 'Triggers' | 'Faults' | 'Danger zone';

interface DirectorButton {
  label: string;
  /** Section in the drawer. Buttons keep the FRD order; sections are contiguous runs of it. */
  group: DirectorGroup;
  /** Rendered text when it depends on live state (e.g. a toggle). Defaults to `label`. */
  display?: (ctx: DirectorContext) => string;
  /** Two-step confirm: the first tap asks, the second tap runs. */
  confirm?: boolean;
  run: (ctx: DirectorContext) => void;
}

const sim = (type: SimActionType) => (ctx: DirectorContext) => ctx.send({ type, device: 'director' });

/** Sim scan: the glasses would send SET_ACTIVE_PATIENT on a scan lock; the server does not map SIM_SCAN yet. */
const scanRoom = (room: string) => (ctx: DirectorContext) => {
  const patient = PATIENTS.find(p => p.room === room);
  ctx.send({ type: `SIM_SCAN_RM_${room}` as SimActionType, device: 'director' });
  if (patient) ctx.send({ type: 'SET_ACTIVE_PATIENT', patientId: patient.id, device: 'director' });
};

/** Exact list and order from FRD section 7 plus Clock +30m (section 6). Labels are copy; do not reword. */
export const DIRECTOR_BUTTONS: readonly DirectorButton[] = [
  { label: 'Start Shift', group: 'Scenario', run: ctx => ctx.send({ type: 'START_SHIFT', device: 'director' }) },
  { label: 'Sim Scan Rm 12', group: 'Scenario', run: scanRoom('12') },
  { label: 'Sim Scan Rm 14', group: 'Scenario', run: scanRoom('14') },
  { label: 'Voice: Done', group: 'Voice and input', run: sim('SIM_VOICE_DONE') },
  { label: 'Voice: Next', group: 'Voice and input', run: sim('SIM_VOICE_NEXT') },
  { label: 'Voice: Undo', group: 'Voice and input', run: sim('SIM_VOICE_UNDO') },
  { label: 'Trigger: Pain', group: 'Triggers', run: sim('SIM_TRIGGER_PAIN') },
  { label: 'Trigger: Wound', group: 'Triggers', run: sim('SIM_TRIGGER_WOUND') },
  { label: 'Capture Wound Photo', group: 'Triggers', run: sim('SIM_CAPTURE_WOUND') },
  { label: 'Voice: Send to Phone', group: 'Triggers', run: sim('SIM_SEND_TO_PHONE') },
  { label: 'Dr. Reply', group: 'Triggers', run: sim('SIM_DR_REPLY') },
  { label: 'Trigger Allergy Alert', group: 'Triggers', run: sim('SIM_ALLERGY_ALERT') },
  { label: 'Add Conflicting Order', group: 'Triggers', run: sim('SIM_ADD_CONFLICT_ORDER') },
  { label: 'Toggle Photo Fail', group: 'Faults', display: ctx => `Toggle Photo Fail: ${ctx.photoFail ? 'ON' : 'OFF'}`, run: sim('SIM_FAIL_PHOTO_UPLOAD') },
  { label: 'Force Offline', group: 'Faults', run: ctx => ctx.setForceOffline(!ctx.forceOffline) },
  { label: 'Clock +30m', group: 'Faults', run: sim('SIM_CLOCK_PLUS_30') },
  { label: 'RESET DEMO', group: 'Danger zone', confirm: true, run: ctx => ctx.send({ type: 'RESET_SESSION', device: 'director' }) },
];

/** Live facts for the preflight panel. All optional so the drawer still renders without them. */
export interface PreflightFacts {
  sessionId: string;
  connected: boolean;
  presence: Record<string, number>;
  directorSelf: boolean;
  telemetry: SessionState['telemetry'];
}

interface Props extends DirectorContext {
  open: boolean;
  onClose: () => void;
  onReset?: () => void;
  facts?: PreflightFacts;
}

const GROUP_ORDER: DirectorGroup[] = ['Scenario', 'Voice and input', 'Triggers', 'Faults', 'Danger zone'];

/** The discreet handle in the top bar that opens the drawer. */
export function DirectorHandle({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="ph-icon-btn ph-director-handle" aria-label="Open Director Drawer" onClick={onOpen}>
      <Icon name="bolt" />
    </button>
  );
}

export function DirectorDrawer({ open, onClose, onReset, facts, ...ctx }: Props) {
  const [armed, setArmed] = useState(false);
  if (!open) return null;
  const c = ctx as unknown as DirectorContext;

  const renderButton = (b: DirectorButton) => {
    if (b.confirm && armed) {
      return (
        <div key={b.label} className="ph-confirm">
          <p className="ph-strong">Wipe the live demo?</p>
          <p className="ph-muted">Clears the shift, med log and photos on every device.</p>
          <Button
            variant="danger"
            block
            onClick={() => { setArmed(false); b.run(c); onReset?.(); }}
          >
            Yes, RESET DEMO
          </Button>
          <Button block onClick={() => setArmed(false)}>Cancel</Button>
        </div>
      );
    }
    const pressed = b.label === 'Force Offline' ? c.forceOffline : b.label === 'Toggle Photo Fail' ? !!c.photoFail : undefined;
    return (
      <Button
        key={b.label}
        variant={b.confirm ? 'danger' : 'secondary'}
        className={pressed ? 'ph-dir-btn ph-dir-on' : 'ph-dir-btn'}
        aria-pressed={pressed}
        onClick={() => (b.confirm ? setArmed(true) : b.run(c))}
      >
        {b.display ? b.display(c) : b.label}
      </Button>
    );
  };

  return (
    <Sheet title="Director" titleId="director-title" onClose={onClose} className="ph-director">
      {facts && (
        <Preflight
          sessionId={facts.sessionId}
          connected={facts.connected}
          presence={facts.presence}
          directorSelf={facts.directorSelf}
          telemetry={facts.telemetry}
        />
      )}

      <p className="ph-muted ph-dir-intro">Simulated events for the demo. No glasses needed.</p>

      {GROUP_ORDER.map(g => (
        <section key={g} className={g === 'Danger zone' ? 'ph-dir-group ph-dir-danger' : 'ph-dir-group'} aria-label={g}>
          <h3 className="ph-label-sm">{g}</h3>
          <div className="ph-dir-grid">{DIRECTOR_BUTTONS.filter(b => b.group === g).map(renderButton)}</div>
        </section>
      ))}
    </Sheet>
  );
}
