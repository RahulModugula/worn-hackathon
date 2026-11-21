import { useEffect, useRef, useState } from 'react';
import type { CameraAdapter } from '../../../hud-kit/platform/types';
import { createBrowserCamera } from '../../../hud-kit/platform/browser';
import { createQrScanner, type QrScanner, type QrScannerOptions } from '../../../hud-kit/scan/qrScanner';
import { createVoiceEngine, type VoiceEngine, type VoiceTier } from '../../../hud-kit/voice/voiceEngine';
import { createIntentMatcher, type IntentMatcher, type IntentSpec } from '../../../hud-kit/voice/intentMatcher';
import type { SessionState } from '../../../../shared/types';
import type { UndoInfo } from './P2Patient';
import { Icon } from './Icon';
import { Button } from './ui';
import {
  countdownText, isAssigned, minutesLeft, openMeds, patientByCode, patientById, type Send,
} from './model';

export const HTTPS_MESSAGE = 'The camera needs an https address. Open the https link on this phone, not http. The buttons below still work.';
export const NO_CAMERA_MESSAGE = 'This browser cannot use the camera here. The buttons below still work.';
export const NOT_ON_LIST = 'Not on your list';

/** Plain-English camera failure, keyed by the adapter's short error name. */
export function cameraMessage(reason: string | undefined): string {
  switch (reason) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission is off for this site. Allow the camera in browser settings, then tap Start camera again. The buttons still work.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this phone. The buttons still work.';
    case 'unsupported':
      return NO_CAMERA_MESSAGE;
    default:
      return 'The camera did not start. The buttons still work.';
  }
}

export function tierNote(tier: VoiceTier | 0): string {
  if (tier === 1) return 'Voice: cloud speech (Deepgram)';
  if (tier === 2) return 'Voice: browser speech';
  return 'Voice: off. The buttons work.';
}

type VoiceIntent = 'done' | 'next' | 'undo' | 'vitals' | 'close' | 'wound';

/** Exact words only, so "not done yet" never logs a med (the voice false-positive gap). */
export const VOICE_INTENTS: IntentSpec[] = [
  { intent: 'done', patterns: [/^done$/, /^all done$/, /^mark (it )?done$/] },
  { intent: 'next', patterns: [/^next$/] },
  { intent: 'undo', patterns: [/^undo$/] },
  { intent: 'vitals', patterns: [/^vitals?$/] },
  { intent: 'close', patterns: [/^close$/] },
  { intent: 'wound', patterns: [/^wound$/] },
];

/** Test seams: a fake camera, scanner or voice engine. Production uses the hud-kit defaults. */
export interface ScanDeps {
  camera?: CameraAdapter;
  createScanner?: (opts: QrScannerOptions) => QrScanner;
  createVoice?: () => VoiceEngine;
}

export interface ScanTalkProps {
  state: SessionState | null;
  nowMin: number | null;
  send: Send;
  /** Logs a med through the same rules as P2 (already given, not yet due). Returns conflict copy or null. */
  logMed: (patientId: string, medId: string) => string | null;
  undo: UndoInfo | null;
  onUndo: () => void;
  onClose: () => void;
  onWound: () => void;
  hasPendingWound: boolean;
  deps?: ScanDeps;
}

/**
 * Plan B (BG-15): the phone scans the wristband and shows the big buttons, for when the glasses cannot.
 * The camera starts only from a tap. Every button works without voice or camera.
 */
export function ScanTalk({ state, nowMin, send, logMed, undo, onUndo, onClose, onWound, hasPendingWound, deps }: ScanTalkProps) {
  const [status, setStatus] = useState('Start the camera, or use the buttons.');
  const [camOn, setCamOn] = useState(false);
  const [voiceNote, setVoiceNote] = useState(tierNote(0));
  const [heard, setHeard] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [showVitals, setShowVitals] = useState(false);

  const cameraRef = useRef<CameraAdapter | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const voiceRef = useRef<VoiceEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unFrameRef = useRef<(() => void) | null>(null);
  const matcherRef = useRef<IntentMatcher | null>(null);

  const patient = patientById(state?.activePatientId ?? null);
  const open = patient ? openMeds(patient, state) : [];
  const current = open.length ? open[cursor % open.length] : null;
  const undoOpen = !!undo && undo.secondsLeft > 0;

  const loadPatient = (patientId: string, name: string, room: string) => {
    send({ type: 'SET_ACTIVE_PATIENT', device: 'phone', patientId });
    setCursor(0);
    setStatus(`Loaded ${name}, Rm ${room}.`);
  };

  const handleCode = (code: string) => {
    const p = patientByCode(code);
    if (!p || !isAssigned(p.id)) {
      setStatus(NOT_ON_LIST);
      return;
    }
    loadPatient(p.id, p.name, p.room);
  };

  /** Paints the adapter's own frames into the reticle stage, so the nurse sees what the scanner sees. */
  const drawFrame = (frame: { width: number; height: number; data: Uint8ClampedArray }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== frame.width) canvas.width = frame.width;
    if (canvas.height !== frame.height) canvas.height = frame.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
  };

  const stopCamera = () => {
    unFrameRef.current?.();
    unFrameRef.current = null;
    scannerRef.current?.disable();
    scannerRef.current = null;
    cameraRef.current?.stop();
    setCamOn(false);
  };

  const startCamera = async () => {
    if (!deps?.camera) {
      if (typeof window !== 'undefined' && window.isSecureContext === false) { setStatus(HTTPS_MESSAGE); return; }
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setStatus(NO_CAMERA_MESSAGE); return; }
    }
    const cam = cameraRef.current ?? deps?.camera ?? createBrowserCamera();
    cameraRef.current = cam;
    setStatus('Starting the camera...');
    const r = await cam.start();
    if (!r.available) {
      setStatus(cameraMessage(r.reason));
      return;
    }
    const make = deps?.createScanner ?? createQrScanner;
    const scanner = make({
      camera: cam,
      onFirstRead: () => setStatus('Reading the wristband...'),
      onLock: code => {
        stopCamera();
        handleCode(code);
      },
      onTimeout: () => {
        stopCamera();
        setStatus('No code read. Hold the wristband in the frame, then tap Start camera again.');
      },
    });
    scannerRef.current = scanner;
    scanner.enable();
    if (typeof cam.onFrame === 'function') unFrameRef.current = cam.onFrame(drawFrame);
    setCamOn(true);
    setStatus('Hold the wristband in the frame.');
  };

  const doDone = () => {
    if (!patient) { setStatus('Load a patient first.'); return; }
    if (!current) { setStatus(`All meds given for ${patient.name}.`); return; }
    const conflict = logMed(patient.id, current.med.id);
    setStatus(conflict ?? `Done: ${current.med.name}. Waiting for the server.`);
  };
  const doNext = () => {
    if (open.length < 2) { setStatus('No other open med.'); return; }
    const nextIdx = (cursor + 1) % open.length;
    setCursor(nextIdx);
    setStatus(`Next: ${open[nextIdx].med.name} ${open[nextIdx].med.dose}.`);
  };
  const doVitals = () => {
    if (!patient) { setStatus('Load a patient first.'); return; }
    setShowVitals(v => !v);
  };
  const doWound = () => {
    if (hasPendingWound) { onWound(); return; }
    setStatus('No wound photo waiting. Say "wound" on the glasses to take one.');
  };
  const doClose = () => {
    stopVoice();
    stopCamera();
    onClose();
  };

  // Voice always calls the latest handlers, so a spoken command never acts on stale state.
  const handlers = useRef<Record<VoiceIntent, () => void>>({ done: () => {}, next: () => {}, undo: () => {}, vitals: () => {}, close: () => {}, wound: () => {} });
  handlers.current = { done: doDone, next: doNext, undo: onUndo, vitals: doVitals, close: doClose, wound: doWound };

  const startVoice = async () => {
    if (voiceRef.current) return;
    const engine = deps?.createVoice ? deps.createVoice() : createVoiceEngine();
    voiceRef.current = engine;
    const matcher = createIntentMatcher({
      intents: VOICE_INTENTS,
      onMatch: m => {
        setStatus(`Heard: ${m.text}`);
        handlers.current[m.intent as VoiceIntent]?.();
      },
    });
    matcherRef.current = matcher;
    engine.on(ev => {
      if (ev.type === 'transcript' && ev.final) {
        setHeard(ev.text);
        matcher.feed(ev.text, true);
      }
    });
    setVoiceNote('Starting voice...');
    const tier = await engine.start();
    setVoiceNote(tierNote(tier));
  };

  function stopVoice() {
    voiceRef.current?.stop();
    voiceRef.current = null;
    matcherRef.current?.reset();
    matcherRef.current = null;
  }

  useEffect(() => () => {
    unFrameRef.current?.();
    scannerRef.current?.disable();
    cameraRef.current?.stop();
    voiceRef.current?.stop();
  }, []);

  const vitals = patient?.vitals;
  const nextLeft = current ? minutesLeft(current.dueMin, nowMin) : null;

  return (
    <section className="ph-view ph-scan" aria-labelledby="scan-title">
      <div className="ph-scan-top">
        <Button variant="ghost" size={40} className="ph-back" onClick={doClose}>
          <Icon name="chevron" size={20} className="ph-back-icon" />Back
        </Button>
      </div>
      <div className={camOn ? 'ph-stage ph-stage-on' : 'ph-stage'}>
        <h1 id="scan-title" className="ph-stage-title">Scan &amp; Talk</h1>
        <canvas ref={canvasRef} className="ph-stage-video" aria-hidden="true" />
        {camOn && <span className="ph-reticle" aria-hidden="true"><i /><i /><i /><i /></span>}
        <p role="status" aria-live="polite" className="ph-scan-status" data-testid="scan-status">{status}</p>
        <div className="ph-stage-actions">
          {camOn ? (
            <Button icon="x" onClick={stopCamera}>Stop camera</Button>
          ) : (
            <Button variant="primary" icon="camera" onClick={startCamera}>Start camera</Button>
          )}
          <Button icon="mic" onClick={startVoice} disabled={!!voiceRef.current}>Start voice</Button>
        </div>
        <p className="ph-muted ph-stage-note" data-testid="voice-note">{voiceNote}</p>
        {heard && <p className="ph-heard">Heard: {heard}</p>}
      </div>

      <div className="ph-scan-patient" data-testid="scan-patient">
        {patient ? (
          <>
            <p className="ph-strong">{patient.name} · Rm {patient.room}</p>
            <p className="ph-muted">
              {current
                ? `Next up: ${current.med.name} ${current.med.dose} · ${countdownText(nextLeft)}`
                : 'All meds given'}
            </p>
            {showVitals && vitals && (
              <p className="ph-vitals-line" data-testid="scan-vitals">
                BP {vitals.bp} · HR {vitals.hr} · {vitals.tempF}°F · SpO₂ {vitals.spo2}%
              </p>
            )}
          </>
        ) : (
          <p className="ph-muted"><Icon name="scan" size={16} /> No patient loaded. Scan a wristband.</p>
        )}
      </div>

      <div className="ph-scan-grid">
        <button type="button" className="ph-scan-big ph-scan-done" onClick={doDone} disabled={!patient || !current}>Done</button>
        <button type="button" className="ph-scan-big" onClick={doNext} disabled={open.length < 2}>Next</button>
        <button type="button" className="ph-scan-big" onClick={onUndo} disabled={!undoOpen}>
          {undoOpen ? `Undo · ${undo?.secondsLeft} s` : 'Undo'}
        </button>
        <button type="button" className="ph-scan-big" onClick={doVitals} disabled={!patient}>Vitals</button>
        <button type="button" className="ph-scan-big" onClick={doClose}>Close patient</button>
        <button type="button" className="ph-scan-big" onClick={doWound} disabled={!hasPendingWound && !patient}>Wound</button>
      </div>
      {!patient && <p className="ph-muted ph-scan-helper">Scan a wristband first</p>}
    </section>
  );
}
