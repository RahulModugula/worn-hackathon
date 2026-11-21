# Pitch: Bedside Glance (read this before you present)

Source rule: **only say numbers from the "Sourced numbers" table, and say assumptions out loud as assumptions.** Never invent a statistic. All data in the demo is synthetic. Research read 2026-11-21; URLs are in the table. Several sources are secondary or summaries; if a reviewer pushes, say "published estimate".

## One line
**Bedside Glance puts the right patient, the right drug and the allergy warning in a nurse's line of sight, hands free, and charts it to the phone in one tap or word.** Glance on the glasses, depth on the phone: Seamless Handoff.

## Who pays, in 20 seconds (answer the hardware maker's question first)
- **Buyer:** hospital nurse managers / CNOs. **Payer:** the health system's nursing and quality budget. First unit: med-surg.
- **Why they pay:** nurse time and safety. A bedside RN costs about **$139K/yr loaded** (BLS median RN wage $97,550, May 2025, x 1.43, our assumed benefits multiplier). Every minute per shift is worth about **$194/yr per nurse**. Market: 3,465,400 US RN jobs in 2025, about 59% in hospitals (BLS OOH, read 2026-11-21).
- **Device price needed:** at 15 min saved per shift and only 50% of it captured, the value is about **$1,450/nurse/year**. Consumer-class glasses ($300-600) pay back in months; a $2,500 enterprise headset needs ~26 min/shift (that is why earlier headset programs stalled). **Our pitch to MicroLumin: a ~$300-600 waveguide display with a camera is exactly the price point where a hospital says yes.** (Assumption: 15 min/shift. No study measures glasses savings yet; the pilot's job is to measure it.)
- **Pilot ask:** one med-surg unit, 5-10 devices, 90 days, measure scan compliance, documentation minutes, near-misses.

## Sourced numbers (use these, nothing else)
| Claim | Number | Source |
|---|---|---|
| Documentation burden | acute-care nurses averaged 4.7 h of EMR documentation per 12-h shift (study year not verified) | escholarship.org/content/qt08x7j3f7/qt08x7j3f7.pdf |
| Flowsheets share of shift | 31% of a 12-h shift (JMIR Nursing 2025) | nursing.jmir.org/2025/1/e69651 |
| Medication errors | roughly one in five observed doses, mostly timing errors (Keers 2013, Ann Pharmacother 47(2):237-256; secondary summary, the 19.6% / 8.0% figures are unverified and not used) | psnet.ahrq.gov summary |
| Barcode scanning gap | workarounds in 66% of administrations per the abstract (results table: 63%); 36% of workarounds were procedural, such as not scanning at all (van der Veen et al., JAMIA 2018;25(4):385-392) | pmc.ncbi.nlm.nih.gov/articles/PMC7646849 |
| Interruptions | 53.1% of administrations were interrupted (2010) | sciencedaily.com/releases/2010/04/100426181958.htm |
| Turnover cost | $60,090 per bedside RN; 17.6% turnover; 8.6% vacancy (NSI 2026, CY2025 data) | nsinursingsolutions.com NSI National Health Care Retention Report |
| Workforce | 3,465,400 US RN jobs (2025); ~59% in hospitals | bls.gov/ooh/healthcare/registered-nurses.htm |
| Hospitals | 6,100 US hospitals, 907,216 staffed beds (AHA 2024 survey) | aha.org/statistics/fast-facts-us-hospitals |
| Peer benchmark | ambient AI scribing saved nurses ~28 min/shift at ~60% use in a 90-day pilot (Corewell) | healthcareitnews.com (Corewell ambient AI) |
| Why headsets died | Google Glass Enterprise ended 2023; HoloLens 2 discontinued 2024; Augmedix's CEO said most providers use phones | 9to5google, macrumors, hitconsultant (see docs/RESEARCH-MARKET.md notes) |
| Market sizes | secondary analysts disagree widely (medical smart glasses ~$2.6B in 2026 to ~$7.6B in 2033, Persistence). Say "analyst estimates", do not lean on it | persistencemarketresearch.com |

Do **not** claim: that our app reduces errors by X%, any time savings measured by us, HIPAA/FDA clearance, real patients, hospital partners.

## Honest positioning (research on regulation, 2026-11-21)
- It is a **documentation and verification aid for nurses**. The nurse decides. The wound feature produces a **draft note for clinician review**; it does **not** measure, stage or diagnose (FDA treats image-analysis tools as devices, so we stay out of that lane on purpose).
- The allergy alert shows **the chart's own allergy list** next to the scanned patient's meds; it does not override or block.
- Privacy by design: thin capture client, no photo gallery or audio storage on the glasses, synthetic data only in the demo, a real deployment needs a BAA, encryption, MDM and unit sign-off.
- Path to production (6 bullets): 1) one-unit pilot, 2) metrics vs control unit, 3) read-only FHIR/Epic app launch first, charting write-back after security review, 4) BAA + SOC 2 roadmap + MDM, 5) documented intended use + FDA determination before any analytics, 6) privacy and infection-prevention sign-off and a clinical champion.

## Why glasses and not a phone (expect this question)
The phone already exists (Rover, handhelds). Our answer: the glasses win at the moments the phone loses: both hands busy, gloves on, standing at the bedside. They deliver **identity + allergy + drug in the first second** without anyone touching a device, and the phone becomes the depth surface (chart, wound review, doctor reply). Seamless Handoff is the product: **start on the glasses, finish on the phone, and the two never disagree** (first-write-wins and 10-second undo across devices).

## Objections and answers
| Reviewer asks | Answer |
|---|---|
| Who actually pays? | The health system. A ~$450 device breaks even at about 4.6 minutes saved per shift (about 2.3 captured at 50%; `calculator.ts`). Payback means device price only, one device per nurse, within one year; it excludes servers, support, training and integration; 15 min/shift is our assumed saving, not a measurement (our arithmetic, BLS wage inputs; the pilot measures real minutes). |
| Why did Glass/HoloLens fail? | Expensive, locked to one vendor, no EHR workflow. We target a low-cost display and a phone-first integration path. |
| Battery / heat / weight? | Scanner runs at 4 FPS and pauses once a patient is loaded. We have not benchmarked battery yet. Say so. |
| Is this FDA regulated? | We deliberately stay a documentation aid: no measurement, no staging, nurse decides. A regulatory opinion comes before any alerting expansion. |
| HIPAA? | Demo uses synthetic data. Production design: no on-device PHI, BAA, encryption in transit and at rest. |
| What did you build this weekend? | Everything in this repo (it was built Nov 20-21). Gemini and Deepgram are optional services; the demo also runs on built-in fallbacks. |
| What if the glasses fail on stage? | The phone Director drawer drives the same flow, and a recorded clean run is on a second device. |

## 90-second table script (reviewer walks up)
1. (0:00-0:15) "Nurses spend hours charting and about 1 in 5 observed opportunities has an error, many of them timing errors. We put the check where the nurse is looking." Put the glasses on / hand them over.
2. (0:15-0:50) Scan the wristband. Maria's card appears: allergy, drug due now, glucose. Say "done". Point at the phone: the chart updated (target under a second; measured only as server ack on localhost, glasses-to-phone latency unmeasured).
3. (0:50-1:10) Teammate also taps it on the phone: the conflict banner shows "Already given ... via glasses". "No double dosing. Undo works from either device for 10 seconds."
4. (1:10-1:20) Wound: say "wound", capture, the phone shows before/after with a draft note; "send to Dr. Okafor", reply lands on the glasses.
5. (1:20-1:30) "A $300-600 device pays for itself at about 15 minutes saved per nurse per shift. We want one med-surg unit for a 90-day pilot."

## 3-minute stage script (finalists)
0:00-0:20 problem + one sourced stat · 0:20-0:40 what it is, one sentence · 0:40-2:25 live demo (scan, meds, done, conflict + undo, wound handoff, offline recovery) · 2:25-2:50 who pays, break-even math, path to production · 2:50-3:00 the ask, then stop. Show the product, never the terminal. Project `/glasses?mirror=1` so the audience sees the HUD. If anything breaks, switch to the Director drawer without apologising, then to the recorded run.

## Ideas to strengthen the pitch if time allows
- A visible "minutes saved" counter in the phone activity feed (clearly labelled as an estimate from the demo's step count, not measured).
- A one-slide ROI calculator with the assumptions editable (minutes per shift, device price).
