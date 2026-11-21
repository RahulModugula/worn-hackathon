import { useState } from 'react';
import type { WoundCapture, WoundCaptureStatus } from '../../../../shared/types';
import { hhmmToMinutes, longTime } from '../../../../shared/clock';
import { assessmentLabel, type Assessment, type Patient } from './model';
import { Icon } from './Icon';
import { Button, Card, Chip, EmptyState, Skeleton, type Tone } from './ui';

interface Props {
  patient: Patient;
  capture: WoundCapture;
  /** Null while the photo is still waiting for an assessment (upload failed or in flight). */
  assessment: Assessment | null;
  status: WoundCaptureStatus;
  capturedLabel: string;
  draft: string;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  onSend: () => void;
  /** Re-sends a photo that failed to upload. Optional: without it the Retry button is hidden. */
  onRetry?: () => void;
  /** Unused since the tab bar; accepted so older callers still type-check. */
  onBack?: () => void;
  reply: WoundCapture['reply'] | null;
}

const SOURCE_TONE: Record<string, Tone> = { 'AI result': 'accent', 'No AI review': 'info', 'Assessment unavailable': 'warn' };

/** Shown on the Wound tab before any photo has been taken. */
export function WoundEmpty() {
  return (
    <section className="ph-view" aria-labelledby="p3-empty">
      <EmptyState icon="camera" title="No wound photo yet">
        Say &ldquo;wound&rdquo; on the glasses to take a photo. It appears here with a draft note to review.
      </EmptyState>
    </section>
  );
}

export function P3WoundReview(p: Props) {
  const { patient, capture, assessment, status } = p;
  const pending = status === 'pending_review';
  const photoFailed = capture.photoUploadFailed;
  const label = assessment ? assessmentLabel(assessment.source) : null;
  const sentTo = capture.sentTo ?? patient.attending;
  const prevAt = patient.wound ? longTime(hhmmToMinutes(patient.wound.lastChangedAt)) : null;

  return (
    <section className={pending ? 'ph-view ph-view-actionbar' : 'ph-view'} aria-labelledby="p3-title">
      <div className="ph-head-block">
        <h1 id="p3-title" className="ph-title">Wound review</h1>
        <p className="ph-muted">{patient.name} · {patient.wound?.site ?? 'wound'}</p>
      </div>

      <div className="ph-compare">
        <figure className="ph-photo">
          <div className="ph-photo-box">
            {patient.wound?.previousPhoto ? (
              <PhotoImg src={patient.wound.previousPhoto} alt="Previous wound photo" />
            ) : <span className="ph-small">No previous photo</span>}
            <span className="ph-photo-tag">Previous</span>
          </div>
          <figcaption className="ph-muted">{prevAt ? `Changed ${prevAt}` : '—'}</figcaption>
        </figure>
        <figure className="ph-photo">
          <div className="ph-photo-box">
            {photoFailed ? (
              <div className="ph-photo-fail">
                <Icon name="alert" size={24} />
                <span className="ph-strong">Photo didn&apos;t upload</span>
                {p.onRetry && <Button size={40} icon="retry" onClick={p.onRetry}>Retry</Button>}
              </div>
            ) : (
              <PhotoImg src={`/api/wound-photo/${encodeURIComponent(capture.captureId)}`} alt="New wound photo" />
            )}
            <span className="ph-photo-tag ph-photo-tag-new">New</span>
          </div>
          <figcaption className="ph-muted">{p.capturedLabel}</figcaption>
        </figure>
      </div>
      <p className="ph-consent"><Icon name="info" size={16} /> Each photo stays in this patient&apos;s chart only. Confirm the patient agreed before you save.</p>

      {assessment === null ? (
        <Card>
          <p className="ph-strong">Waiting for the assessment</p>
          <div className="ph-skel-lines"><Skeleton height={14} /><Skeleton height={14} width="70%" /></div>
        </Card>
      ) : (
        <>
          <div className="ph-draft-banner">
            <Icon name="info" size={20} />
            <span className="ph-draft-title">Draft for clinician review</span>
            <Chip tone={SOURCE_TONE[label!] ?? 'neutral'} data-testid="assessment-source">{label}</Chip>
          </div>
          {assessment.source === 'unavailable' ? (
            <Card role="note"><p>No assessment was made for this photo. Compare it yourself before saving.</p></Card>
          ) : assessment.source === 'fallback' ? (
            <Card role="note"><p>No AI review was done for this photo. Compare it with the previous one and write your own note before saving.</p></Card>
          ) : (
            <>
              <Card>
                <h2 className="ph-h3">AI finding</h2>
                <p>{assessment.finding}</p>
              </Card>
              <Card>
                <h2 className="ph-h3">Compared with previous</h2>
                <p>{assessment.comparison}</p>
              </Card>
            </>
          )}
        </>
      )}

      <label className="ph-label" htmlFor="p3-draft">Draft note (edit before saving)</label>
      <textarea
        id="p3-draft"
        className="ph-input"
        rows={4}
        value={p.draft}
        disabled={!pending}
        onChange={e => p.onDraftChange(e.target.value)}
      />

      {status === 'saved' && <p className="ph-done"><Icon name="check-circle" size={20} /><span>Saved to chart</span></p>}
      {status === 'sent' && (
        <p className="ph-done">
          <Icon name="check-circle" size={20} />
          <span aria-hidden="true">Sent to {sentTo}</span>
          <span className="ph-sr-only">✓ Sent to {sentTo}</span>
        </p>
      )}

      {p.reply && (
        <Card className="ph-reply" role="note">
          <p className="ph-label-sm">Reply from {p.reply.from}</p>
          <p>{p.reply.text}</p>
        </Card>
      )}

      {pending && (
        <div className="ph-actionbar">
          <Button variant="primary" icon="save" onClick={p.onSave}>Save to chart</Button>
          <Button icon="send" onClick={p.onSend}>Send to {patient.attending}</Button>
        </div>
      )}
    </section>
  );
}

/** Photo that degrades to text instead of a broken image icon. */
function PhotoImg({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="ph-small ph-photo-missing"><Icon name="image" size={24} />{alt} unavailable</span>;
  return <img src={src} alt={alt} className="ph-img" onError={() => setFailed(true)} />;
}
