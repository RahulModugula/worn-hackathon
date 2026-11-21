# Demo script (3 minutes, stage) and 90-second table version

All data is synthetic. Nothing here has been run on real M6 glasses; the glasses beats work through the Director drawer or `/glasses?mirror=1` projected if hardware is unavailable. Say so plainly if asked.

## Before you start (2 minutes)
1. `npm run build && npm start`; open the printed LAN URL on the phone, `/glasses?mirror=1` on the projector, Director drawer > Preflight shows green.
2. Director > Reset demo (press and hold). Confirm the HUD shows the idle card.
3. Have the recorded run open in another tab as the fallback.

## 3-minute stage cut
| Time | Beat | Say | Do |
|---|---|---|---|
| 0:00 | Problem | One sourced stat, then the character: a fictional nurse on a medication pass. | Phone on My shift. |
| 0:20 | What it is | One sentence: hands-free bedside medication check on glasses, synced to the phone. | Show HUD idle. |
| 0:40 | Scan | Wristband scan opens the patient in under 2 s. | Scan or Director > Scan wristband. |
| 1:00 | Meds | Due meds, allergy bar fixed, nothing in the center of the view. | Point at HUD card. |
| 1:20 | Done | "Done" on glasses, phone updates (target under 1 s; measured only as server ack on localhost, on-glasses latency unmeasured; do not claim a number). | Say or tap Done. |
| 1:40 | Conflict + undo | A second device tries the same dose: first write wins, either can undo for 10 s. | Director > Conflict. |
| 2:00 | Wound handoff | Photo, draft for clinician review, send to attending. | Wound tab. |
| 2:20 | Offline | Drop the network, log a dose, reconnect, it syncs once. | Director > Offline. |
| 2:35 | Who pays | /impact page: the break-even math and the assumption it rests on. | Open /impact. |
| 2:50 | Ask | One sentence ask, then stop. | |

## 90-second table cut
Problem (15 s) > scan + meds (25 s) > done + conflict/undo (25 s) > who pays (15 s) > ask (10 s). Hand the phone to the reviewer for the Done tap.

## If something breaks
Use the Director drawer without apologising, then the recorded run. Never blame the network first.
