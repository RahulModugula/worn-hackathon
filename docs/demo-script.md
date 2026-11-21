# Demo script: 3:00 stage arc and 90 s table cut

All data is synthetic. Say so first if asked. Everything on `/stage` is measured on this network, now; on-glasses latency is not measured.

## Roles
- **Priya** (presenter): wears the glasses, speaks the voice cues. Her name is the signed-in nurse on the glasses.
- **Marcus**: holds a phone opened at `/phone?nurse=N-02` and accepts the handoff (the phone shows Marcus T. as the signed-in nurse and routes the handoff to him).
- **Director** (offstage): a phone at `/phone?director=1`. Every voice cue has a numbered twin button in Director > Stage beats.
- Projector: `/stage` (the glasses mirror at left, sync health at right). Laptop `/glasses?mirror=1` is the fallback.

## Pre-stage (5 minutes, in this order)
1. `npm run build && npm start`; open the printed LAN or Render URL on every device. Projector: `/stage`.
2. Director > Preflight: all four chips (Allergy order, Glasses, Two phones, Director) green; the rest green or amber.
3. Director > Stage beats > press and hold **Reset to pre-stage** (1.2 s). It runs reset, start shift, add conflicting order. Check the HUD shows the idle card and the Allergy order chip turns green.
4. Priya scans Rm 12 once to confirm the glasses are linked; the chip row stays green. Then Reset to pre-stage again so the stage starts clean.
5. Recorded video open in another tab (see Fallbacks).

## 3:00 stage arc
| Time | Beat | Say | Do (voice, with Director twin) |
|---|---|---|---|
| 0:00 to 0:35 | OPENING: allergy catch | "A new order lands for Maria. The chart says penicillin allergy. The glasses catch it before the hand does." | Scan Rm 12; Critical Allergy shows. Priya says "acknowledge". Twin: **1 Acknowledge allergy**. Then "done": it logs the next real med, never the allergen. |
| 0:35 to 1:15 | MIDDLE A: chaos, dead-zone dose | "Now the elevator. No signal." | Twin: **2 Chaos: link down + done** (8 s). The rail shows Not linked and a down timer; Priya says "done" (queued, offline); the link returns and the Replay line fills in: replayed count, queued seconds, 0 lost only when every device is converged. |
| 1:15 to 1:55 | MIDDLE B: shift-change handoff | "Shift change. Priya hands Rm 12 to Marcus." | Priya says "hand off". Twin: **3 Hand off Rm 12**. The offer appears on Marcus's phone as a handoff sheet (also reachable from the **Hand off Rm 12** card on the patient screen). He taps **Read back** on each critical item (allergy and recent doses); **Accept handoff** unlocks only when none are left, and only on a different device than the offerer's. The glasses then show Handoff accepted, and the stage chain reads "Handoff accepted". The summary is built from the shift log, not by AI. |
| 1:55 to 2:30 | Who pays | "Hospitals pay for minutes." | Open `/impact`: the break-even math and the assumption it rests on. |
| 2:30 to 2:50 | CLOSING: "Already given via glasses" | "Marcus tries the dose Priya already gave. First write wins." | On Marcus's phone, tap the med Priya logged: `Already given {time} via glasses`. The rail Conflicts line names the device that won. |
| 2:50 to 3:00 | Ask | One sentence ask, then stop. | |

## 90 s table cut
| Time | Beat | Do |
|---|---|---|
| 0:00 to 0:25 | Allergy catch | Scan, "acknowledge" (twin 1), "done" logs the safe med. |
| 0:25 to 0:55 | Dead-zone dose | Twin 2; point at Link and Replay on `/stage`. |
| 0:55 to 1:15 | Handoff | Twin 3; the reviewer taps Accept on Marcus's phone. |
| 1:15 to 1:30 | Who pays + ask | `/impact`, one sentence ask. |

## Voice cue and Director twin
| Voice | Twin button | Sends |
|---|---|---|
| "acknowledge" | 1 Acknowledge allergy | `SIM_ACKNOWLEDGE` |
| "done" with no signal | 2 Chaos: link down + done | `SIM_CHAOS_DROP` `{ms: 8000, thenDone: true}` |
| "hand off" | 3 Hand off Rm 12 | `SIM_HANDOFF_OFFER` to N-02 |

## Fallbacks
- Glasses will not connect: project the laptop `/glasses?mirror=1`, or `/stage` with the Director twins; keep going, do not apologise.
- Any beat stalls for 3 seconds: press its twin. Do not repeat the voice cue.
- Projector or network dies: play the recorded video. Record the 3:00 arc and the 90 s cut ahead of time, each captioned `Recorded {date}; synthetic data`. Say it is a recording.

## Honesty lines
Say: "Synthetic patients." "These numbers are measured on this network, right now." "The handoff summary is built from the shift log with fixed rules."
Never claim:
- on-glasses latency (not measured; the rail shows server-ack timing only);
- error reduction or any clinical outcome;
- real patients or real hospital data;
- authentication or HIPAA-grade security (the demo has none beyond the Director key);
- that I-PASS evidence applies to nurses: the published I-PASS results are from physician residents;
- that the summary is AI-generated.
