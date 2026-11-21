import { useState } from 'react';
import type { HandoffPacket, Severity } from '../../../../shared/types';
import { nextNurse, nurseName, type Patient, type RosterNurse, type Send } from './model';
import { Button, Card, Chip } from './ui';
import { SeverityPicker } from './HandoffSheet';

let counter = 0;
/** `[A-Za-z0-9_-]{1,64}`, unique per tap on this tab. */
function newHandoffId(patientId: string): string {
  counter += 1;
  return `H-${patientId}-${Date.now().toString(36)}${counter}`.slice(0, 64);
}

/** P2 handoff: offer this patient to the next roster nurse, then show offered / accepted status from the server packet. */
export function HandoffCard({ patient, me, packet, send }: {
  patient: Patient; me: RosterNurse; packet: HandoffPacket | null; send: Send;
}) {
  const [severity, setSeverity] = useState<Severity | null>(null);
  const to = nextNurse(me.id);
  if (!to) return null;
  const open = packet?.status === 'offered' ? packet : null;
  const done = packet?.status === 'accepted' ? packet : null;

  return (
    <div className="ph-group">
      <h2 className="ph-h2 ph-section-title">Handoff</h2>
      <Card>
        {done && (
          <p className="ph-strong" data-testid="handoff-accepted">
            <Chip tone="accent" icon="check-circle">Accepted</Chip>{' '}
            Handed off to {nurseName(done.toNurseId)} {done.acceptedLabel ?? ''}
          </p>
        )}
        {open && (
          <p className="ph-strong" data-testid="handoff-offered">
            <Chip tone="info" icon="clock">Offered</Chip>{' '}
            Waiting for {nurseName(open.toNurseId)} to read back and accept
          </p>
        )}
        {!open && (
          <>
            <SeverityPicker value={severity} onChange={setSeverity} />
            <Button block icon="user" disabled={!!open}
              onClick={() => send({
                type: 'HANDOFF_OFFER', device: 'phone', handoffId: newHandoffId(patient.id), patientId: patient.id, toNurseId: to.id,
                ...(severity ? { severity } : {}),
              })}>
              Hand off Rm {patient.room}
            </Button>
            <p className="ph-muted">To {to.name}. Built from the shift log, not written by AI.</p>
          </>
        )}
      </Card>
    </div>
  );
}
