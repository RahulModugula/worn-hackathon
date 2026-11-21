// Director SIM_* commands, mapped onto the same events the real inputs produce.
import type { GEvent, GState } from './stateMachine';

export interface SimHandling {
  events: GEvent[];
  /** SIM_CAPTURE_WOUND: the capture this starts takes /data/wound-fallback.jpg instead of a camera frame. */
  simCapture?: boolean;
}

export function simHandling(type: string, s: GState): SimHandling | null {
  const scan = (room: string): SimHandling => {
    const p = s.patients.find((x) => x.room === room);
    return { events: p ? [{ type: 'scanLock', payload: p.qrPayload, force: true }] : [] };
  };
  switch (type) {
    case 'SIM_SCAN_RM_12': return scan('12');
    case 'SIM_SCAN_RM_14': return scan('14');
    case 'SIM_VOICE_DONE': return { events: [{ type: 'intent', intent: 'done' }] };
    case 'SIM_VOICE_NEXT': return { events: [{ type: 'intent', intent: 'next' }] };
    case 'SIM_VOICE_UNDO': return { events: [{ type: 'intent', intent: 'undo' }] };
    case 'SIM_TRIGGER_PAIN': return { events: [{ type: 'intent', intent: 'pain', force: true }] };
    case 'SIM_TRIGGER_WOUND': return { events: [{ type: 'intent', intent: 'wound', force: true }] };
    case 'SIM_SEND_TO_PHONE': return { events: [{ type: 'intent', intent: 'send', force: true }] };
    case 'SIM_ALLERGY_ALERT': return { events: [{ type: 'intent', intent: 'allergy', force: true }] };
    // SIM_FAIL_PHOTO_UPLOAD is a session flag (photoUploadShouldFail); uploads read it, nothing to replay here.
    case 'SIM_FAIL_PHOTO_UPLOAD': return { events: [] };
    case 'SIM_CAPTURE_WOUND': {
      const lead: GEvent[] = s.patientId ? [] : scan('12').events; // no patient yet: load Rm 12 first
      return { events: [...lead, { type: 'intent', intent: 'capture', force: true }], simCapture: true };
    }
    case 'SIM_ADD_CONFLICT_ORDER': return { events: [] }; // the order lands in session.extraOrders; the glasses derive the alert from data
    case 'SIM_CLOCK_PLUS_30': return { events: [] }; // the session clock offset already moves the due list
    case 'SIM_DR_REPLY': return { events: [] }; // the server answers with DR_REPLY, which arrives as a notice
    default: return null;
  }
}
