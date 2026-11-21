import { useEffect, useRef, useState } from 'react';
import type { HandoffItem, HandoffPacket, Severity } from '../../../../shared/types';
import { SEVERITIES } from '../../../../shared/types';
import { nurseName, patientById, unreadCritical, type Send } from './model';
import { Icon } from './Icon';
import { Button, Chip, Sheet } from './ui';

/** The last server result, only its failure text is used. */
export interface LastResultLike { seq: number; ok: boolean; message?: string }

const SECTIONS: { id: HandoffItem['section']; title: string }[] = [
  { id: 'P', title: 'Patient' },
  { id: 'A', title: 'Action list' },
  { id: 'S', title: 'Situation' },
];

/**
 * Receiving nurse's I-PASS sheet. Built from the server packet only: sections come from `packet.items`, read-back
 * state from `packet.readBack`, and every refusal is the server's own text. The final S of I-PASS (synthesis) is
 * the read-back of each critical item; Accept stays disabled until none is left.
 */
export function HandoffSheet({ packet, send, lastResult, onClose }: {
  packet: HandoffPacket; send: Send; lastResult: LastResultLike | null; onClose: () => void;
}) {
  // Only a refusal that arrives while this sheet is open counts: ignore whatever was last before it mounted.
  const baseline = useRef(lastResult?.seq ?? 0);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!lastResult || lastResult.seq <= baseline.current) return;
    if (!lastResult.ok && lastResult.message) setRefusal(lastResult.message);
    else if (lastResult.ok) setRefusal(null);
  }, [lastResult]);

  const patient = patientById(packet.patientId);
  const left = unreadCritical(packet);
  const total = packet.items.filter(i => i.critical).length;
  const severity: Severity | 'Not stated' = packet.severity ?? 'Not stated';

  return (
    <Sheet title={`Handoff · ${patient ? `Rm ${patient.room}` : packet.patientId}`} titleId="handoff-title" onClose={onClose} className="ph-handoff">
      <p className="ph-muted ph-handoff-from">
        From {nurseName(packet.fromNurseId)} at {packet.createdLabel} · Built from the shift log, not written by AI
      </p>
      <p className="ph-handoff-sev" data-testid="handoff-severity">
        <span className="ph-label-sm">Illness severity</span>
        <Chip tone={packet.severity ? 'info' : 'neutral'}>{severity}</Chip>
      </p>

      {SECTIONS.map(sec => {
        const rows = packet.items.map((item, index) => ({ item, index })).filter(r => r.item.section === sec.id);
        if (rows.length === 0) return null;
        return (
          <section key={sec.id} className="ph-handoff-sec" aria-label={sec.title}>
            <h3 className="ph-h2 ph-section-title">{sec.title}</h3>
            <ul className="ph-handoff-list">
              {rows.map(({ item, index }) => {
                const done = packet.readBack.includes(index);
                return (
                  <li key={index} className="ph-handoff-item">
                    <span className="ph-handoff-text">
                      {item.critical && <Chip tone="warn" icon="alert">Critical</Chip>}
                      <span>{item.text}</span>
                    </span>
                    {item.critical && (done ? (
                      <Chip tone="accent" icon="check-circle" data-testid={`readback-done-${index}`}>Read back</Chip>
                    ) : (
                      <Button size={48} aria-label={`Read back: ${item.text}`}
                        onClick={() => send({ type: 'HANDOFF_READBACK', device: 'phone', handoffId: packet.handoffId, index })}>
                        Read back
                      </Button>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="ph-handoff-sec" aria-label="Synthesis">
        <h3 className="ph-h2 ph-section-title">Synthesis</h3>
        <p className="ph-strong" data-testid="handoff-progress">
          {total === 0 ? 'No critical items to read back' : left.length === 0 ? `All ${total} critical items read back` : `Read back ${total - left.length} of ${total} critical items`}
        </p>
      </section>

      {refusal && <p role="alert" className="ph-handoff-refusal"><Icon name="alert" size={20} /><span>{refusal}</span></p>}

      <div className="ph-stack">
        <Button variant="primary" block disabled={left.length > 0}
          onClick={() => send({ type: 'HANDOFF_ACCEPT', device: 'phone', handoffId: packet.handoffId })}>
          Accept handoff
        </Button>
        {left.length > 0 && <p className="ph-muted">Accept unlocks after you read back {left.length} more critical {left.length === 1 ? 'item' : 'items'}.</p>}
        <Button block onClick={onClose}>Not now</Button>
      </div>
    </Sheet>
  );
}

/** Plain 3-way choice offered with the handoff. Nothing selected means the packet says "Not stated". */
export function SeverityPicker({ value, onChange }: { value: Severity | null; onChange: (v: Severity | null) => void }) {
  return (
    <fieldset className="ph-sev">
      <legend className="ph-label-sm">Illness severity (optional)</legend>
      <div className="ph-sev-row" role="radiogroup" aria-label="Illness severity">
        {SEVERITIES.map(s => (
          <button key={s} type="button" role="radio" aria-checked={value === s}
            className={value === s ? 'ph-sev-btn ph-sev-on' : 'ph-sev-btn'} onClick={() => onChange(value === s ? null : s)}>
            {value === s && <Icon name="check" size={16} />}{s}
          </button>
        ))}
      </div>
      {value === null && <p className="ph-muted">Not stated unless you pick one.</p>}
    </fieldset>
  );
}
