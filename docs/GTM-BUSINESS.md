# Bedside Glance: go-to-market and business case

Written 2026-11-21 for investors, hospital buyers and hardware partners. Bedside Glance is a working prototype built Nov 20-21, 2026, running on synthetic data. It has not been tested on real M6 glasses, has no customers, no pilot, no clearance and no measured time saving. Every number below is either (a) a documented input of the `/impact` calculator (`src/apps/bedside-glance/impact/calculator.ts`), (b) a sourced figure tagged below, or (c) a labelled hypothesis.

Evidence tags: [P] primary source read directly, [S] secondary or search-result summary, [V] vendor material, [U] unverified general knowledge or our own judgement, [H] hypothesis of ours that a pilot must test.

Note on inputs: `docs/RESEARCH-INSTITUTIONS.md` and `docs/RESEARCH-NURSES.md` did not exist when this was written. Re-check this document against them when they land.

## 1. Positioning and customer

**One-sentence wedge.** Bedside Glance verifies the patient, the drug and the chart's allergy list in a nurse's line of sight during the medication pass, and hands the record off to a phone in one word or tap, so it works on low-cost display glasses and falls back to the phone alone.

What it is not: not a medical device claim, not a replacement for the EHR, not a wound diagnostic (the wound note is a draft for clinician review). See `docs/PITCH.md`.

**Why this wedge.** Medication administration is the most repeated bedside task with a measurable failure mode. Published, sourced figures (all [S] unless noted; see section 8): roughly one in five observed doses has an error, mostly timing errors (Keers 2013, secondary summary; the 19.6% / 8.0% figures are unverified); barcode workarounds in 66% of administrations per the abstract (63% in the results table) and 36% of workarounds procedural, such as not scanning (van der Veen 2018, JAMIA); 53.1% of administrations interrupted. These describe the problem, not our effect. We have no evidence that our product reduces any of them.

**Segments (ordered).**

| Order | Segment | Why | Risk |
|---|---|---|---|
| 1 | Med-surg unit in a hospital that already runs BCMA on an EHR with a mobile app | Highest nurse headcount and med volume per unit; the workflow (scan wristband, scan drug, chart) is standardised; BCMA already exists so we add a layer rather than a new process [H] | Compliance is already pushed by Epic Rover on phones, so glasses must beat a phone at the bedside |
| 2 | Step-down or oncology unit with high-alert drugs | Higher cost of error, nurses used to double-checks | Regulatory scrutiny is higher; later |
| 3 | Long-term care and skilled nursing | Lower-cost buyers, price-sensitive, need a cheap device | Different EHR landscape and staffing model; not researched |

**ICP (ideal first customer) [H].** A 300-700 bed community or regional health system, with a CNO or nursing-informatics lead who has already deployed a handheld or phone BCMA program, a med-surg unit with persistent scan-workaround or documentation-time complaints, and an IT team willing to run a 90-day, non-integrated pilot. Why a mid-size system: faster security review than an academic centre, large enough that a unit rollout (30 devices) matters. We have not interviewed any such buyer.

## 2. Business model

### 2.1 What the customer's math is (from the calculator)

Calculator defaults: 30 nurses per unit, 15 minutes saved per shift, 50% of saved time captured as real capacity, $450 device, $139,497 loaded cost per nurse-year (BLS median RN wage $97,550, May 2025, all industries, x 1.43; the multiplier is our assumption), 173 shifts per year, 720-minute shift, 5 beds per nurse on shift, 500-bed hospital, $120 per device-year running cost, 3-year device life.

Derived (our arithmetic, reproduced from the calculator formulas):
- Cost per nurse-minute: 139,497 / (173 x 720) = $1.12.
- One minute saved per shift is worth 173 x 1.12 = about $194 per nurse-year at 100% capture, about $96.9 at 50%.
- Value per nurse-year at 15 min and 50%: about $1,453.
- Device-only payback at $450: 450 / (1,453 / 12) = 3.7 months. With the $120 running cost: 4.1 months.
- Net value per device-year (value minus running cost minus device price / 3 years): about $1,183.
- Break-even minutes per shift (device price only): 450 / (173 x 1.12 x 0.5) = 4.6 min saved, 2.3 min captured.
- One unit (30 devices): about $43,600 per year of value at defaults. A 500-bed hospital at 5 beds per nurse is 100 devices: about $145,300 per year.

Value per nurse-year by minutes saved and capture (value = minutes x 193.75 x capture):

| Minutes saved per shift | 25% captured | 50% captured | 75% captured |
|---|---|---|---|
| 5 | $242 | $484 | $727 |
| 10 | $484 | $969 | $1,453 |
| 15 (default) | $727 | $1,453 | $2,180 |
| 20 | $969 | $1,937 | $2,906 |

Caveat that matters: "captured" is the share of saved time that becomes real capacity (fewer overtime hours, more time at the bedside). It is not free cash. Payback in the calculator is device price only; it excludes servers, support, training, wristbands, integration and our software fee. The 15 minutes is an assumption. No study measures glasses savings.

### 2.2 Revenue options

| Model | How it works | For | Against |
|---|---|---|---|
| A. Per nurse-seat subscription (recommended starting hypothesis) | Fee per active device/nurse seat per month; hospital buys or leases the M6 | Tracks the value (one device per nurse in the calculator); simple to budget | Seats idle on low-census weeks; hospital may count seats by headcount, not by shift |
| B. Per staffed bed | Fee per bed on the live unit per year | Matches how hospitals budget nursing and quality; independent of device count | Our cost and value scale with nurses, not beds; at 5 beds per nurse, $60 per bed-year equals $300 per seat-year |
| C. Device bundle | M6 plus software sold as one monthly price, MicroLumin as reseller or co-seller | One PO, no capital request, simplest pilot | MicroLumin carries inventory and refresh; revenue split unresolved |
| D. Pilot fee | Small fixed fee for 90 days, 5-10 devices | Filters tyre-kickers; funds support | May slow a security review; could be $0 if the sponsor wants speed |

All prices below are [H]. We have not asked any customer what they would pay.

### 2.3 Pricing hypotheses and sensitivity

Customer view per seat-year. Hospital bears: our subscription S, running cost $120 (calculator), device $450 amortised over 3 years ($150). Payback below is the calculator's definition extended by S: device price over monthly (value - running cost - S).

| Subscription | $/seat/year | Value at 15 min, 50% ($1,453) | Net customer value per year after S, $120, $150 | Payback months | Break-even minutes per shift (50% capture) |
|---|---|---|---|---|---|
| $25 per seat per month | $300 | 21% of value | $883 | 5.2 | 5.9 |
| $40 per seat per month | $480 | 33% | $703 | 6.3 | 7.7 |
| $60 per seat per month | $720 | 50% | $463 | 8.8 | 10.2 |

Break-even minutes = (S + 120 + 150) / 96.9 at 50% capture. Payback = 450 / ((1,453 - 120 - S) / 12).

At the low-saving end (5 min, 50%, $484 per nurse-year), a $300 subscription leaves $484 - 120 - 300 = $64 per year before the device, so payback is about 84 months: the product does not pay back. This is the honest floor: below about 6 minutes per shift saved at 50% capture, a $25 per month price fails the hospital's own test. The `/impact` page lets a reader reproduce these cells by editing minutes, capture and device price; it has no subscription input today, so S is outside the calculator and must be checked by hand until one is added.

A rule of thumb to defend in a pilot: price software at no more than about 20-30% of measured value per seat [H].

### 2.4 What MicroLumin earns

The M6 street price is not known to us. The $300-600 range in `docs/PITCH.md` is our target ask to the maker, not a quote; $450 is the calculator default [H]. Revenue to the maker is device sales at that price plus whatever it earns on refresh and accessories. All rows are arithmetic on stated assumptions, not forecasts.

| Scenario | Devices | Device revenue at $450 | Assumption |
|---|---|---|---|
| 90-day pilot | 10 | $4,500 | Upper end of the 5-10 device ask |
| One med-surg unit | 30 | $13,500 | Calculator default, one device per nurse |
| One 500-bed hospital, every bed covered | 100 | $45,000 | 500 beds / 5 beds per nurse; upper bound, assumes all units adopt |
| Annual refresh, same 100-device hospital | about 33 per year | about $15,000 per year | 3-year life; ignores breakage, loss, battery replacement |
| Ten such hospitals | 1,000 | $450,000 | Illustrative, no pipeline exists |

Scale check from the sourced figures: the AHA reports 6,100 US hospitals and 907,216 staffed beds [S], which is about 149 staffed beds per hospital on average. At 5 beds per nurse that is about 30 devices per average hospital if every bed were covered. The 100-device hospital is therefore a larger-than-average target, not a typical one. We did not find a reliable count of med-surg beds or of units on BCMA, and do not publish a market size. Analyst estimates exist for medical smart glasses (about $2.6B in 2026 to $7.6B in 2033 [S], Persistence Market Research) but analysts disagree widely; we do not rely on them.

## 3. Unit economics, payback and what falsifies them

Per seat, base case at $25 per month, $450 device, 15 min saved, 50% capture [H]:

| Line | Per seat-year | Basis |
|---|---|---|
| Customer value created | $1,453 | Calculator |
| Customer running cost | $120 | Calculator default; covers MDM, charging, spares [H] |
| Customer device amortisation | $150 | $450 / 3 |
| Our subscription revenue | $300 | Hypothesis |
| Our cost to serve | not measured | See below |

Our cost to serve is unknown. The prototype runs one Node process; a local soak with 50 simulated sessions held 100% of acknowledgements with p95 7.4 ms on a MacBook over localhost (`docs/COMPAT-PERF.md`, 2026-11-21). That says nothing about hospital networks, EHR integration, support staff, security audits, insurance or AI-service costs (Gemini and Deepgram are optional and not costed). Do not quote a gross margin.

Customer payback: 3.7 months device-only, 4.1 with running cost, about 5 months with a $300 subscription (section 2.3).

**What would falsify these numbers**
1. Measured time saved is under about 5 minutes per shift (device-only break-even at 50% capture is 4.6; about 5.9 with a $300 subscription). Test: stopwatch or EHR audit-log study of med-pass and charting minutes, intervention vs control unit.
2. Capture rate is well under 50%: saved minutes do not turn into fewer overtime hours or more bedside time. Test: unit overtime and patient-contact observation.
3. Nurses do not wear the glasses for the whole shift (comfort, battery, infection-control cleaning). Test: logged active hours per device per shift; unverified, battery not benchmarked.
4. A device is shared across shifts, which would lower seats per nurse. The calculator assumes one device per nurse; sharing changes both value per device and the pricing unit.
5. Hospital rejects a seat price because IT, MDM and support cost more than the $120 default.
6. The M6 cannot be bought at $300-600 or cannot meet hospital requirements (see section 6).

Not modelled, upside only: turnover. NSI puts the cost of losing a bedside RN at $60,090 at 17.6% turnover [S]; any retention effect of lighter charting would be on top of the calculator, but no evidence links this product to retention.

## 4. Go-to-market

### 4.1 Land: 90-day single-unit pilot

Scope: one med-surg unit, 5-10 devices, 90 days, non-integrated (synthetic-to-real mapping handled by a read-only feed or manual roster, to be agreed). Pilot compares to a control unit or to the unit's prior baseline.

Success metrics and proposed thresholds [H], to be agreed with the clinical champion before day 1:

| Metric | How measured | Proposed go threshold |
|---|---|---|
| Barcode scan compliance on pilot shifts | EHR BCMA audit log | No decrease, and at least 5 points above baseline or control |
| Minutes per shift on med-pass and charting | Time-motion sample and audit log | At least 6 min per shift measured (just above the break-even in section 3) |
| Wrong-patient or wrong-drug near-misses caught at scan | Staff-reported and event log | Documented, not scored as proof |
| Nurse adoption | Share of pilot nurses wearing devices at least 50% of shifts | At least 70% |
| Nurse-reported usability | Short survey (n at least 15) | Median at least 4 of 5; any safety concern escalated |
| Reliability | Sessions lost, offline recoveries, battery ending a shift early | No safety incidents; battery lasts a full shift [unknown today] |
| Security and privacy | Zero PHI incidents | Zero |

Stop rules: any patient-safety concern, any PHI incident, or fewer than half of pilot nurses willing to continue after 4 weeks.

### 4.2 Buying committee

| Role | Cares about | What they need from us |
|---|---|---|
| CNO / nurse manager (economic buyer, champion) | Time, safety, retention | Pilot metrics and a clinical champion |
| Nursing informatics | Workflow fit, EHR | Integration roadmap, read-only first |
| CIO / IT / security | MDM, network, PHI | Architecture review, no on-device PHI, patching plan |
| Compliance / privacy officer | HIPAA | BAA, data-flow diagram, audit logs |
| Infection prevention | Cleaning of head-worn devices | Manufacturer cleaning guidance (not obtained) |
| Pharmacy and medication safety | Allergy and alert logic | Proof we show the chart's own allergy list and do not override |
| Procurement / finance | Price, contract | Seat price, refresh terms |

### 4.3 Security and compliance path [U unless noted]

1. Today: synthetic data only, no BAA, no SOC 2, no penetration test. Thin glasses client with no gallery or audio storage by design (`docs/PITCH.md`).
2. Before a pilot with real patients: sign a HIPAA business associate agreement with the hospital; sign BAAs with any subprocessor that sees PHI or confirm they do not (the optional speech and AI services must be off or covered); encrypt in transit and at rest; audit log; role-based access; device management (MDM) with remote wipe; written intended-use statement.
3. Integration roadmap: read-only patient and medication context first (FHIR read or EHR app-launch, for example SMART on FHIR), then charting write-back after security review. Epic and other vendors set their own program rules and timelines; we have not applied or verified requirements.
4. Within 12 months: SOC 2 Type I plan, then Type II [H]; third-party security assessment.
5. Regulatory: stay a documentation and verification aid; no measurement, staging or diagnosis. FDA's January 2026 clinical decision support guidance keeps software that analyses medical images outside the non-device exemption [P, `docs/HYDROGEL-RESEARCH.md`, FDA text read 2026-11-21], so the wound-photo draft needs a formal regulatory assessment before any real-patient use. Obtain regulatory counsel; we have not.

### 4.4 Channel

- **Through the glasses maker.** MicroLumin gets device pull-through and a reference application; we get distribution and device support. Open terms: revenue share, co-selling, exclusivity, SDK stability. Today the M6 runs Android 9 with a phone BLE SDK and plain Android APIs; our HUD is a web page in a WebView wrapper (Topology B) and has not run on a real device.
- **Through systems integrators and EHR consultancies** that already staff Epic and mobile rollouts, for security review and integration. None approached.
- **Direct** to nursing leaders through the pilot, using the champion and metrics as the reference.

### 4.5 Twelve-month roadmap [H]

| Quarter | Milestone | Exit criterion |
|---|---|---|
| Q1 (by Feb 2027) | Run on real M6: WebView version recorded, battery and heat benchmarked, key and voice input verified; first clinician interviews | Written device report; at least 10 nurse and 5 nursing-leader interviews |
| Q2 | Pilot-ready: BAA template, MDM, audit log, read-only data feed, regulatory opinion | One signed pilot |
| Q3 | 90-day pilot run | Metrics against section 4.1 |
| Q4 | Decide: expand to second unit, begin FHIR write-back, SOC 2 Type I | Paying second unit or a documented no-go |

## 5. Competition and substitutes

Honest comparison. Sources are search summaries or vendor material, read 2026-11-21; none verified in depth.

| Option | What it is | Where it beats us | Where we differ |
|---|---|---|---|
| Phone BCMA via Epic Rover and similar | Nurse's smartphone with scanner sleeve or camera scanning. Epic Research (July 2024) reports higher BCMA compliance on mobile devices than on computers, e.g. 96.8% in emergency departments [S, Epic-affiliated, observational]. Cleveland Clinic Florida piloted 80 iPhones with scanner sleeves, with connection timeouts that forced rescans [S]. | Already deployed, EHR-native, no new device, trusted by IT, writes to the chart | Phone needs a hand and attention; we aim for hands-free identity, allergy and drug in view. Not yet shown to matter more than the phone's 96.8% compliance |
| RealWear and similar industrial headsets | Rugged head-worn Android, voice control. Navigator 520 listed around $3,150 at the maker's shop, reseller prices $2,115-$3,235 [S] | Mature, enterprise-supported, MDM-ready, voice-first | About 5-7x our assumed $450 device price; we have not seen a nursing medication workflow from them. Our price argument depends on MicroLumin hitting $300-600 |
| Vuzix and other smart glasses | Display glasses for enterprise | Not researched here [U] | Not assessed |
| Ambient AI documentation | Epic's Chart with Art nursing, Abridge, Microsoft Dragon Copilot (extending nurse recording in Epic Rover to Android), Ambience nursing suite [S]. A Corewell pilot reports about 28 min per shift saved at about 60% use [S, vendor-adjacent]; Mercy reported end-of-shift note time cut from 3.5 min to 32 s [S, pilot] | They attack documentation, our largest assumed saving, with real pilot claims and EHR integration, and they are backed by the EHR vendor | They do not verify the patient and drug at the point of administration; we do. They are also more likely to be bundled free by the EHR. Our 15 min/shift assumption overlaps with theirs: they may take the savings we claim |
| Do nothing / current workflow | Computer on wheels and desk | Zero cost | Scan workarounds persist (66%, [S]) |

**Defensibility, stated honestly.** Today we have a prototype and a design discipline, not a moat: a display law for a see-through waveguide (clear zone, 528 px card, 18 px text), first-write-wins sync across glasses and phone with a 10-second undo, offline outbox, a Chromium-69 compatibility pipeline, and 604 passing tests (README). Durable advantage, if any, must come from (1) integration depth with an EHR, (2) clinical evidence from pilots, (3) a distribution agreement with the glasses maker and (4) workflow data. None exist yet. A competent phone-first competitor or Epic itself could ship the scan-and-confirm flow on glasses; our best defence is speed, device partnership and evidence.

## 6. Risks and mitigations

| Risk | Why it matters | Mitigation | Status |
|---|---|---|---|
| Regulatory boundary | Verification is a documentation aid; image analysis (wound photo) is the part FDA treats as a device [P] | Keep wound note as clinician-reviewed draft, no measurement or staging; regulatory counsel before real patients; do not claim exemption | Not assessed by counsel |
| Alert behaviour | Showing allergies can drift into decision support | Show the chart's own allergy list, never override or block; nurse decides | Designed; not clinically reviewed |
| Privacy | Wearable camera near patients, wound photos are PHI | No on-device storage, BAA, MDM, camera only when scanning, unit and patient notice | Designed; unaudited |
| Reliability | A failed scan or sync in a med pass is a safety event | Server-authoritative state, idempotent events, offline outbox, graceful fallbacks, soak tested on localhost [COMPAT-PERF] | Not tested on hospital Wi-Fi or real glasses |
| Battery, heat, weight | Head-worn device for a 12-hour shift | Scanner runs at 4 FPS and pauses once a patient is loaded; charging dock and swap plan | Not benchmarked |
| Adoption | Nurses reject head-worn devices; some patients dislike cameras | Phone fallback, nurse co-design, opt-in, clear signage | No nurse interviewed |
| Infection control | Head-worn device cleaning | Maker guidance, wipe protocol with infection prevention | Not obtained |
| Platform and supplier | Android 9 age, WebView about Chromium 69, single small hardware partner | Build for old WebView (guarded), keep phone fallback, multi-device roadmap | Real WebView version unknown |
| Competitive bundling | EHR vendor adds the feature | Be a partner layer, own the glasses workflow and the evidence | Open |
| Savings overstated | Whole case rests on minutes | Measure in the pilot; publish the break-even | Open |

### What we have NOT validated

- That the M6 works in our flow on a real device (display, WebView version, camera scan, voice, battery, heat, comfort, ring or touchpad input).
- Any time saving, error reduction, compliance gain or retention effect from Bedside Glance.
- The 15 min per shift and 50% capture assumptions; the 1.43 loaded-cost multiplier; one device per nurse.
- Willingness to pay at any price in section 2.3; the M6 price and MicroLumin's margin.
- Scan latency and glasses-to-phone latency on real hardware (only localhost server ack was measured).
- Android 9 speech recognition on the glasses; the display-only fallback depends on it.
- Integration with any EHR, FHIR access, or Epic program eligibility.
- HIPAA readiness, SOC 2, penetration test, MDM compatibility, infection-control approval.
- Regulatory status of the wound-photo draft, and of the allergy display.
- That a hospital will accept a head-worn camera on a med-surg unit.
- Market size: we found no reliable count of med-surg units, BCMA-equipped hospitals or nursing glasses buyers.
- Vuzix and other smart-glasses competitors; independent evidence for Rover connectivity and safety outcomes.

## 7. Why MicroLumin should care (one page)

All figures are labelled assumptions, not forecasts.

**The ask.** A hospital-grade reference application for the M6, and a partnership to take it to nursing units at a device price the buyer's math supports.

**Why the price point matters.** At the calculator's defaults one nurse's saved time is worth about $1,453 a year, which supports a $300-600 device that pays back in 2-5 months device-only. A $3,000 enterprise headset breaks even device-only at about 31 min saved per shift at 50% capture (3,000 / 96.9), against 4.6 for $450, so it stalls unless the saving is large. The M6's low price is the commercial argument; it must be confirmed that it can reach that price and pass hospital requirements.

**Units (illustrative, at $450):**
- Pilot: 10 devices, $4,500.
- One med-surg unit: 30 devices, $13,500.
- One 500-bed hospital fully covered: 100 devices, $45,000, plus about 33 refreshes a year (about $15,000) on a 3-year life.
- Ten such hospitals: 1,000 devices, $450,000.
The average US hospital has about 149 staffed beds [S], so most hospitals are smaller: plan on tens of devices per site, not hundreds.

**Recurring revenue angles [H].**
- Annual refresh at a 3-year device life.
- Accessory and replacement sales: charging docks, ear-pieces, frames sized for clinical use, cleaning-safe covers.
- Managed device service: MDM, remote support and warranty, priced per device per year (the calculator's $120 running cost is a placeholder for this).
- Revenue share on our software subscription (for example $25 per seat per month, section 2.3), terms to negotiate.

**Reference-customer value.** A published hospital pilot with measured minutes, scan compliance and near-miss data would be MicroLumin's first clinical proof point, usable for other nursing and healthcare use cases. That value only exists if the pilot is measured honestly and may show no benefit.

**What MicroLumin can unblock.** (1) Confirm device price, volume pricing and availability; (2) real WebView version, key and mic access, battery and heat data; (3) cleaning and safety guidance for clinical use; (4) a BAA-friendly device-management path; (5) an introduction to one hospital or integrator.

**What we commit to.** A 90-day pilot plan with success thresholds fixed in advance (section 4.1), honest reporting including a null result, and no clinical or regulatory claims we cannot support.

## 8. Sources

Read 2026-11-21 unless noted. Many are secondary; treat figures as published estimates.

| Claim | Source | Tag |
|---|---|---|
| Calculator inputs and formulas | `src/apps/bedside-glance/impact/calculator.ts` (repo) | [P] |
| BLS RN median wage $97,550 (May 2025), 3,465,400 RN jobs (2025), about 59% in hospitals; read 2026-11-21 | https://www.bls.gov/ooh/healthcare/registered-nurses.htm | [S] |
| 6,100 hospitals, 907,216 staffed beds (AHA 2024) | https://www.aha.org/statistics/fast-facts-us-hospitals (via `docs/PITCH.md`) | [S] |
| Med errors roughly one in five doses, mostly timing (Keers 2013; 19.6% / 8.0% unverified) | https://psnet.ahrq.gov (secondary summary) | [S] |
| Barcode workarounds 66% (abstract; 63% in results), 36% of workarounds procedural (van der Veen 2018, JAMIA) | https://pmc.ncbi.nlm.nih.gov/articles/PMC7646849 | [S] |
| 53.1% of administrations interrupted (Westbrook 2010) | https://www.sciencedaily.com/releases/2010/04/100426181958.htm | [S] |
| Turnover cost $60,090, 17.6% turnover (NSI 2026) | https://www.nsinursingsolutions.com (NSI National Health Care Retention Report) | [S] |
| Corewell ambient AI, about 28 min per shift at about 60% use | https://www.healthcareitnews.com/news/corewell-healths-ambient-ai-cuts-nursing-documentation-time-52 | [S] |
| Epic Research: mobile BCMA compliance higher than on computer; 96.8% in emergency departments | https://epicresearch.org/articles/improved-barcode-scanning-for-medication-administration-with-mobile-devices-compared-to-standalone-scanners | [S, Epic-affiliated] |
| Cleveland Clinic Florida iPhone Rover pilot, timeouts | https://consultqd.clevelandclinic.org/mobile-app-makes-it-easy-to-deliver-meds | [S] |
| Wellstar Rover case, Scandit for Rover | https://www.epic.com/epic/post/nurses-improve-efficiency-and-safety-by-documenting-care-on-the-go; https://www.scandit.com/partners/epic-ios/ | [V] |
| Epic Chart with Art nursing, Mount Sinai | https://www.epic.com/epic/post/mount-sinai-medical-center-among-first-in-the-nation-to-bring-ambient-ai-to-nurses/ | [V] |
| Abridge nursing KLAS First Look, Ambience nursing suite | https://hitconsultant.net/2026/04/02/klas-report-abridge-ambient-ai-nursing-flowsheets-ehr/; https://hitconsultant.net/2026/06/23/ambience-healthcare-launches-inpatient-nursing-suite/ | [S] |
| Microsoft Dragon Copilot nursing on Epic Rover Android | https://techcommunity.microsoft.com/t5/healthcare-and-life-sciences/why-nursing-needs-a-different-kind-of-ai-and-how-dragon-copilot/ba-p/4499564 | [V] |
| RealWear Navigator 520 pricing ($3,150 maker; $2,115-$3,235 resellers) | https://shop.realwear.com/products/realwear-navigator-520; https://www.cdwg.com/product/realwear-navigator-520-workband/7297331 | [S] |
| Medical smart glasses market estimate | https://www.persistencemarketresearch.com (via `docs/PITCH.md`); not relied on | [S] |
| FDA CDS guidance (Jan 2026): image-analysis software stays a device | https://www.fda.gov/media/109618/download (via `docs/HYDROGEL-RESEARCH.md`) | [P] |
| Stress and compatibility measurements | `docs/COMPAT-PERF.md` (2026-11-21, MacBook, localhost) | [P] |
| Glass Enterprise ended 2023; HoloLens 2 discontinued 2024 | via `docs/PITCH.md` (9to5google, macrumors, hitconsultant); not re-read | [S] |
| HIPAA BAA, SOC 2, SMART on FHIR, MDM requirements | general knowledge, not looked up in this pass | [U] |
| Vuzix, other smart-glasses vendors | not researched | [U] |
