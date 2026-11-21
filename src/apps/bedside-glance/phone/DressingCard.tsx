import { useState } from 'react';
import { DRESSING_LABELS, DRESSING_TYPES, type DressingType, type WoundCapture } from '../../../../shared/types';
import { longTime } from '../../../../shared/clock';
import { dressingSummary, minToTimeInput, timeInputToMin } from './model';
import { Button, Card, Chip } from './ui';

export interface DressingInput { dressingType: DressingType; changedAtMin?: number; intervalHours?: number | null }

/** Nurse-chosen presets. `null` = per protocol. Not a recommendation: nothing is preselected. */
const PRESETS: { key: string; label: string; hours: number | null }[] = [
  { key: '24', label: '24 h', hours: 24 },
  { key: '48', label: '48 h', hours: 48 },
  { key: '72', label: '72 h', hours: 72 },
  { key: 'protocol', label: 'Per protocol', hours: null },
];

interface Props {
  capture: WoundCapture;
  /** Demo clock now, minutes since midnight; null before the shift starts. */
  nowMin: number | null;
  onSet?: (v: DressingInput) => void;
}

/** Dressing documentation entered by the nurse on a wound capture. Documentation only: no AI, no advice. */
export function DressingCard({ capture, nowMin, onSet }: Props) {
  const d = capture.dressing;
  const locked = capture.status === 'saved' || capture.status === 'sent';
  const [type, setType] = useState<DressingType | ''>(d?.type ?? '');
  const [time, setTime] = useState<string | null>(d?.changedAtMin !== undefined ? minToTimeInput(d.changedAtMin) : null);
  const [interval, setIntervalKey] = useState<string>(d && d.type !== 'none' && d.intervalHours !== undefined ? (d.intervalHours === null ? 'protocol' : String(d.intervalHours)) : '');

  const timeValue = time ?? (nowMin !== null ? minToTimeInput(nowMin) : '');
  const changedMin = timeInputToMin(timeValue);
  const preset = PRESETS.find(p => p.key === interval);
  const nextDue = changedMin !== null && preset && preset.hours !== null ? (changedMin + preset.hours * 60) % 1440 : null;
  const ready = type === 'none' || (type !== '' && changedMin !== null && preset !== undefined);

  const save = () => {
    if (!onSet || type === '') return;
    if (type === 'none') { onSet({ dressingType: 'none' }); return; }
    if (changedMin === null || !preset) return;
    onSet({ dressingType: type, changedAtMin: changedMin, intervalHours: preset.hours });
  };

  return (
    <Card as="section" className="ph-dressing" aria-labelledby="p3-dressing">
      <div className="ph-dr-head">
        <h2 id="p3-dressing" className="ph-h3">Dressing</h2>
        <Chip tone="info">Documented by nurse</Chip>
      </div>
      {d && <p className="ph-strong" data-testid="dressing-summary">{dressingSummary(d)}</p>}
      {locked ? (
        !d && <p className="ph-muted">No dressing documented.</p>
      ) : (
        <>
          <label className="ph-label-sm" htmlFor="p3-dr-type">Dressing type</label>
          <select id="p3-dr-type" className="ph-dr-ctl" value={type} onChange={e => setType(e.target.value as DressingType | '')}>
            <option value="">Choose type</option>
            {DRESSING_TYPES.map(t => <option key={t} value={t}>{DRESSING_LABELS[t]}</option>)}
          </select>
          {type !== 'none' && (
            <>
              <label className="ph-label-sm" htmlFor="p3-dr-time">Last changed</label>
              <input id="p3-dr-time" className="ph-dr-ctl" type="time" value={timeValue} onChange={e => setTime(e.target.value)} />
              <p className="ph-label-sm" id="p3-dr-int">Change interval (you set it)</p>
              <div className="ph-dr-presets" role="group" aria-labelledby="p3-dr-int">
                {PRESETS.map(p => (
                  <Button key={p.key} size={48} className="ph-dr-preset" aria-pressed={interval === p.key} onClick={() => setIntervalKey(p.key)}>{p.label}</Button>
                ))}
              </div>
              {nextDue !== null && <p className="ph-muted">Next due {longTime(nextDue)}</p>}
              {preset && preset.hours === null && <p className="ph-muted">No next-due time is set. Follow your unit&apos;s protocol.</p>}
            </>
          )}
          <Button variant="primary" block disabled={!ready} onClick={save}>Save dressing</Button>
        </>
      )}
      <p className="ph-small ph-muted">Documentation aid. Type and times are what you enter.</p>
    </Card>
  );
}
