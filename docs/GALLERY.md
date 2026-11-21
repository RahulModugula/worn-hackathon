# Bedside Glance: screenshot gallery

Real captures from the production build, taken by `npm run screenshots` (headless Chrome driving the real app through the Director controls). All data is synthetic. Regenerate after any UI change.

## The glasses HUD (640x480, black = see-through)

![Hero montage of the glasses HUD states](img/hero-hud.png)

| Idle | Scanning | Meds card |
|---|---|---|
| ![G1 idle](img/hud-g1-idle.png) | ![G2 scanning](img/hud-g2-scanning.png) | ![G4 meds card](img/hud-g4-meds-card.png) |

| Med logged | PRN available | Critical allergy |
|---|---|---|
| ![G5 med logged](img/hud-g5-med-logged.png) | ![G6 PRN](img/hud-g6-prn.png) | ![Critical allergy](img/hud-critical-allergy.png) |

| Wound prompt | Wound prompt with documented dressing | Wound assessment |
|---|---|---|
| ![G7 wound prompt](img/hud-g7-wound-prompt.png) | ![G7 wound prompt with dressing](img/hud-g7-wound-dressing.png) | ![G8 wound assessment](img/hud-g8-wound-assessment.png) |

| Conflict banner | Color theme meds card | Color theme critical allergy |
|---|---|---|
| ![Conflict banner](img/hud-conflict-banner.png) | ![G4 color theme](img/hud-g4-meds-card-color.png) | ![Critical allergy, color theme](img/hud-critical-allergy-color.png) |

Stage mirror (`?mirror=1`):

![Mirror](img/hud-mirror.png)

## The stage page (`/stage`, 1280x720)

The projector view: the HUD mirror at left and sync health at right. Everything shown is measured on this network, now.

| Default | Linked | Link down | Recovered, 0 lost |
|---|---|---|---|
| ![Stage](img/stage-1280x720.png) | ![Stage linked](img/stage-linked.png) | ![Stage chaos](img/stage-chaos.png) | ![Stage recovered](img/stage-recovered.png) |

## The phone (390x844)

| My shift | Patient detail | Wound review | Activity feed |
|---|---|---|---|
| ![P1](img/phone-p1-my-shift.png) | ![P2](img/phone-p2-patient.png) | ![P3](img/phone-p3-wound-review.png) | ![P4](img/phone-p4-activity-feed.png) |

| Dressing documentation | Conflict banner | Director drawer + preflight | Scan & Talk (Plan B) |
|---|---|---|---|
| ![Dressing card](img/phone-p3-dressing.png) | ![Phone conflict banner](img/phone-conflict-banner.png) | ![Director drawer](img/phone-director-drawer.png) | ![Scan and Talk](img/phone-scan-talk.png) |

Handoff sheet on the receiving nurse's phone (taller capture so Accept handoff is visible):

<img src="img/phone-handoff-sheet.png" alt="Handoff sheet with Read back buttons and Accept handoff" width="390">

## The business case page (`/impact`)

| Desktop / projector | Phone |
|---|---|
| ![Impact 1280x720](img/impact-1280x720.png) | ![Impact 390x844](img/impact-390x844.png) |

## Printable wristband codes (`/qr`)

![QR print page](img/qr-print-794x1123.png)

## Demo loop

![Demo loop](img/demo.gif)
