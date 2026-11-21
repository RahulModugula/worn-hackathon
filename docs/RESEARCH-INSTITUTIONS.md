# Research: medical institutions as buyers of nurse-facing smart glasses

Scope: how hospitals decide on and buy wearable or AR devices, the security and compliance gates, market and workforce sizes, existing deployments, objections, a pilot design, and what this means for the MicroLumin M6 pitch.

Method and dates: web research on 2026-11-21. Tags: [P] primary (journal, regulator, government, hospital system), [S] secondary (trade press, law firm summary, vendor-neutral blog), [V] vendor or market-research marketing. Where the search returned only a snippet and I did not open the page, this is stated. Nothing here is a measured result for Bedside Glance. Assumptions are labelled.

## Corrections to docs/PITCH.md (found while checking sources)

- **RN median wage (resolved 2026-11-21: PITCH, README, decks and the calculator now use $97,550 and about $139,497 loaded).** PITCH.md used a BLS median hospital RN wage of $100,220. The BLS Occupational Outlook page read on 2026-11-21 gives the all-industry median as **$97,550 (May 2025)**, not $100,220. I could not find the $100,220 hospital-specific figure in the sources read. Loaded cost at the PITCH multiplier (x1.43) becomes about **$139,500/yr**, not $143K. Fix the PITCH figure or cite the hospital-specific BLS table (OEWS) for the $100,220 value. [P] https://www.bls.gov/ooh/healthcare/registered-nurses.htm (read 2026-11-21)
- **Employment.** BLS: about 3,465,400 RN jobs in 2025, 59% in hospitals. This matches PITCH. The BLS page shows projected growth of **6% for 2025-2035**. PITCH does not use the growth figure. [P] same URL.
- **Hospital counts.** AHA 2026 edition: **6,100 hospitals, 907,216 staffed beds, 5,121 community hospitals (FY2024 data)**. This matches PITCH. [P] https://www.aha.org/statistics/fast-facts-us-hospitals (read 2026-11-21)
- **Google Glass Enterprise.** Sales stopped 2023-03-15; software support ended 2023-09-15. Matches PITCH. [S] https://9to5google.com/2023/03/15/google-glass-enterprise-edition-discontinued/ (read 2026-11-21, search snippet)
- **HoloLens 2.** Discontinued in 2024; security updates through 2027-12-31; no successor announced. Matches PITCH's "discontinued 2024". [S] https://roadtovr.com/microsoft-hololens-2-discontinued-support-2027-hololens-3/ (read 2026-11-21, search snippet)

## 1. Who decides and how hospitals buy

What the sources support:

- Most hospitals route new technology through a **value analysis committee (VAC)** or product review committee. Products that connect to a network or carry infection risk usually pull in **IT security, biomedical engineering and infection prevention**. Source: general hospital procurement descriptions. [S] https://www.worldhealthexpo.com/insights/healthcare-management/developing-effective-value-analysis-committees (read 2026-11-21, search snippet)
- Some systems run an **expedited track** for low-impact or pre-approved requests, and a bypass for emergency purchases with post-purchase review. [S] same search set (university VAC descriptions, search snippet)
- Pre-screening can send a device with no FDA status to the **institutional review board** rather than the technology committee (Duke process described in a search snippet). [S] (Duke page not opened; URL not recorded.)
- A vendor toolkit suggests a VAC program can be launched or optimised in about **45 days**, and recommends mapping the request-to-approval timeline. [V] https://www.symplr.com/hubfs/Hospital%20Value%20Analysis%20Toolkit.pdf (search snippet, 2026-11-21)
- After committee approval, pricing and contract terms are negotiated separately with the vendor. [S] same search set.

Roles (CNO, CNIO, CMIO, IT security, procurement, biomed, infection prevention, unit managers): the role split above is consistent across the sources, but **I found no source that states who holds the budget or signs off on a nursing device in a given system.** Treat the table below as a practitioner model to confirm in discovery calls, not as sourced fact.

| Role | Likely interest | Likely veto | Status |
|---|---|---|---|
| CNO / nursing quality | Time at bedside, med-pass safety, retention | Nurse disruption, union or staffing optics | Unsourced model |
| CMIO / CNIO (nursing informatics) | EHR workflow, documentation, clinical content | Any second screen or unapproved EHR write | Unsourced model; Corewell's nursing informatics leader publicly leads its ambient AI work [S] |
| IT security | Network, data at rest, MDM, vendor security | Unsupported OS, no MDM, cloud storage of PHI | Supported in general terms (section 2) |
| Biomed / clinical engineering | Electrical safety, device inventory, repair | Unmanaged battery devices | Unsourced model |
| Infection prevention | Cleaning and disinfection of head-worn devices | No validated cleaning method | Supported as a gap (section 2) |
| Procurement / VAC | Price, contract, total cost, references | Unproven vendor, no references | Supported in general terms |

Timelines and pilot structure: I found **no peer-reviewed or survey data on end-to-end VAC cycle time or CMIO/CNO/IT review durations.** The 45-day figure is a vendor toolkit claim. Plan on months, not weeks, for a first hospital contract; this is an unsourced estimate. The pilot-to-scale path (one unit, then a service line, then system-wide) is common practice but I did not find a source that measures how often it succeeds.

## 2. Security and compliance gates

- **HIPAA and BAAs.** HHS says a covered entity or business associate may use a cloud service to store or process ePHI only after signing a BAA with the provider, and that a service-level agreement does not replace a BAA. [P] https://www.hhs.gov/hipaa/for-professionals/faq/2075/may-a-hipaa-covered-entity-or-business-associate-use-cloud-service-to-store-or-process-ephi/index.html (**page returned HTTP 403 on fetch on 2026-11-21; statement taken from search snippet, not verified in full text**)
- **Mobile devices.** HHS and ONC guidance says covered entities must protect ePHI on mobile devices, with mobile device management (MDM), passcodes and configuration settings. [P] https://www.hhs.gov/guidance/document/fact-sheet-managing-mobile-devices-your-health-care-organization (search snippet, 2026-11-21; not opened)
- **Device security disclosure.** The MDS2 (Manufacturer Disclosure Statement for Medical Device Security) is an NEMA/HIMSS form, now **ANSI/NEMA HN 1-2019**. It is the manufacturer's answer to its clinical users. HHS 405(d) says the form should not be the sole basis for procurement. Hospitals often require it. [P] https://webstore.ansi.org/standards/nema/ANSINEMAHN2019 (listing read 2026-11-21); [P] https://405d.hhs.gov/Documents/405d-network-connected-medical-device-security-pulse-check_R.pdf (search snippet). 405(d) HICP is voluntary guidance, not a manufacturer regulation. [S] (vendor compliance blog, search snippet)
- **EHR integration.** The HL7 SMART App Launch framework (OAuth 2.0 based) is the standard way a user-facing app connects to a FHIR server; current version **2.2.0 (STU 2.2)**. [P] https://hl7.org/fhir/smart-app-launch/ (read 2026-11-21)
- **Epic.** Epic's developer documentation (fhir.epic.com) is login-gated; I could not read current Epic requirements. A 2019 MITRE/ONC document describes the process: about 3-4 weeks for approval after the app is written, and a membership and per-approval fee. **These figures are 2019 and should not be used.** [P, dated] https://oncprojectracking.healthit.gov/wiki/download/attachments/101613598/SMART%20on%20FHIR%20Epic%20Testing%20and%20Approvals.pdf (search snippet). Vendor blogs give 8-12 weeks or 3-6 months; unverified.
- **Infection control for head-worn devices.** Guidance is thin. NSW Clinical Excellence Commission (2021) found no published guidelines for cleaning head-mounted displays and wrote one for VR headsets used in education: hand hygiene before use, wipe with neutral detergent, replace the facial interface. [P] https://www.cec.health.nsw.gov.au/__data/assets/pdf_file/0005/925385/Information-for-HWs-Cleaning-and-disinfecting-virtual-reality-equipment-v3.0.pdf (search snippet, 2026-11-21). A review reports bacteria including S. aureus on XR headsets. [S] Consumer headset makers warn against alcohol on some models (secondary report only; unverified). **No source covers smart glasses specifically.** Our answer must come from the M6 maker's cleaning instructions and the hospital's infection prevention team.
- **Cybersecurity questionnaires.** Expect an MDS2, a SOC 2 report or equivalent, a pen-test summary, a data-flow diagram, and questions on encryption, MDM, logging and breach notification. The list is from common practice, not a cited source; the MDS2 part is cited above.
- **FDA.** FDA's revised clinical decision support (CDS) guidance was issued **2026-01-06**. It allows enforcement discretion for a single clinically appropriate recommendation, and moves the "time-critical" limit into Criterion 4: software may not let a clinician independently review the basis for a recommendation if it is intended for time-critical decisions. It covers clinician-facing software only. [S] https://www.cov.com/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance (read 2026-11-21); primary FDA document https://www.fda.gov/media/191561/download (listed in search, not opened). **Implication:** a med-check warning at the bedside may be argued as time-critical. Our "chart's own allergy list, nurse decides, no override" design is the right direction; the regulatory read must be checked by counsel.

## 3. Market size and workforce

Workforce (primary):
- **RNs:** 3,465,400 jobs (2025); 59% employed by hospitals (about 2.04 million, our arithmetic); projected growth 6% for 2025-2035. [P] https://www.bls.gov/ooh/healthcare/registered-nurses.htm (read 2026-11-21)
- **RN median pay:** $97,550 (May 2025), all industries. [P] same URL. Hospital-specific median not verified.
- **Hospitals:** 6,100 (2026 edition, FY2024 data); 907,216 staffed beds; 5,121 community hospitals. [P] https://www.aha.org/statistics/fast-facts-us-hospitals (read 2026-11-21)
- **Bedside nurses (count):** **not found.** BLS does not split bedside from total RNs in the sources read. Do not use a bedside-nurse number without a source.

Market size (analyst estimates; definitions differ, so spreads are large):
- Medical smart glasses, broad definition: about **$2.6B in 2026 rising to $7.6B in 2033** (15.9% CAGR), Persistence Market Research. [V] https://www.persistencemarketresearch.com/market-research/medical-smart-glasses-market.asp (search snippet, 2026-11-21)
- Medical smart glasses, other firm: about **$2.23B in 2025** (Market Research Future). [V] (snippet only)
- Healthcare AR glasses, narrower: **$347M in 2025, $767M by 2034** (Intel Market Research). [V] https://www.intelmarketresearch.com/healthcare-ar-glasses-market-42189 (snippet). GII Research: **$168.1M in 2025, $181.6M in 2026**. [V] https://www.giiresearch.com/report/ires2136931-healthcare-ar-glasses-market-global-forecast.html (snippet)
- Nurse-facing wearables, hospital enterprise: **no sized source found.**

Price points hospitals accept: **no sourced price data found** for RealWear, Vuzix, Google Glass Enterprise, HoloLens 2 or the M6 in hospital contracts. The "$300-600 is the price point where a hospital says yes" line in PITCH.md is our assumption, not a sourced fact. Get real quotes from MicroLumin and from two hospital procurement contacts before using it externally.

## 4. Existing deployments and evidence

| Device or program | Setting | What was shown | Source and tag | Why it stalled or limits |
|---|---|---|---|---|
| Google Glass (2013-2015 pilots) | ED nurses, Denmark, n=11 | Call quality below average for 55%; sound quality the main problem | [S] https://www.springermedizin.de/can-google-glass-facilitate-work-for-nurses-in-the-emergency-dep/9667436 (2015 abstract) | Audio, battery (CMAJ commentary: about 45 min recording) |
| Google Glass + SnapCap | Wound care, Stanford, 16 nurses | Hands-free wound photo pilot; authors report limits | [P] PLOS ONE 2015 (snippet; URL not recorded) | Authors list limitations of the system |
| Google Glass systematic review | 30 studies | 11/30 (37%) reported low-moderate satisfaction; best results in student training | [P] https://mhealth.jmir.org/2017/10/e159/PDF (snippet) | Small, heterogeneous studies |
| Google Glass Enterprise Edition 2 | Enterprise, incl. healthcare | Sales ended 2023-03-15; support ended 2023-09-15 | [S] 9to5google (above) | Vendor exit: the main stall reason for enterprise buyers |
| Microsoft HoloLens 2 | Enterprise, surgery and training | Discontinued 2024; security updates to 2027-12-31; no successor | [S] roadtovr (above) | Vendor exit; price |
| RealWear Navigator 500 | NHS North Tees (training, theatre livestream, 2023) | Access for students; claims are vendor-amplified; Wi-Fi drops led to SIM use | [S] https://www.computerweekly.com/news/366554934/North-Tees-and-Hartlepool-NHS-Trust-uses-RealWear-headsets-for-training (search snippet) | Connectivity; no independent outcome data |
| Vuzix M400 | MERGE Solutions, remote surgical support | 280 surgeries with smart glasses by 2023 | [V] https://www.vuzix.com/blogs/case-studies/merge-solutions-vuzix (vendor case study) | Remote device-rep guidance, not nursing |
| Smart glasses, ED, Hangzhou Asian Games | Single hospital, retrospective cohort | AR glasses cut patient care time vs conventional communication | [P] https://pmc.ncbi.nlm.nih.gov/articles/PMC12234398 (search snippet) | Single site, retrospective |
| Smart glasses, prehospital EMS | Simulated, pilot randomised crossover, 16 sessions (2026) | Potential to improve physician-guided task completion; longer interactions | [P] https://pubmed.ncbi.nlm.nih.gov/42364464/ (snippet) | Simulation only |
| Smart glasses, nurse usability (Japan, Jan 2026) | 5 nurses | Reduced documentation time; near-100% task completion; input-method and distraction issues | Unverified (no URL recorded; from a search summary) | Tiny n |
| Apple Vision Pro | UCSD-linked radiology, 25 physicians (Jan-Mar 2025) | Feasibility and perceived usability; 12% eye strain | [P] (snippet; URL is ctisus.com journal-club page) | Physicians, not nurses |
| Apple Vision Pro | UCSD surgery, 32 cases | Mean 34.4 vs 42.7 min; no complications in either arm | [S] https://vr.org/articles/vision-pro-surgery-study-19-percent-faster-2026 (Aug 2026 report; not checked against the paper) | Single site |
| Apple Vision Pro | Duke, hip arthroscopy | Stryker app with FDA De Novo for intra-op use | [V] (snippet) | Device-specific app, not general |
| Meta | Not found | No hospital nursing deployment found | n/a | n/a |
| Ambient AI (for contrast; not glasses) | Corewell, 2 med-surg units, 90 days, 101 RNs | 44% of nurses reported time saved (self-report); Epic flowsheet latency about 9% better | [S] https://www.healthcareitnews.com/news/corewell-healths-ambient-ai-cuts-nursing-documentation-time-52 (snippet) | Self-report; health system says not systemwide |
| Ambient AI (for contrast) | Mercy, 3 pilot units | 22% less flowsheet documentation time per shift | [S] (Becker's/TechTarget snippets) | Vendor-tool specific |
| Ambient AI (for contrast) | Univ. of Wisconsin | Randomised, enrolling trial on flowsheet time | [P] NCT07456241 (registry snippet; no results posted) | Not yet reported |

Summary of the evidence: **no independent, multi-site, controlled study of smart glasses for inpatient nursing med administration exists in what I found.** The best nursing data is about wearables for documentation, in small or single-site studies.

Why pilots stalled (from the sources): (a) vendor exit (Glass, HoloLens); (b) audio and connectivity problems; (c) battery and heat; (d) distraction and input method; (e) privacy concerns and hospital administration reluctance to adopt new technology (CMAJ commentary; date not checked). The CMAJ comment on EHR integration: feasible for records, harder for pumps and monitors.

## 5. Top 8 objections a CNO or CMIO would raise, and honest answers

1. **"Who pays, and what is the return?"** Answer: at 15 min saved per shift, the value is large on paper, but **no source measures glasses time savings.** The 15-minute figure is our assumption. The pilot is how we find out. Do not claim a return until the pilot reports it.
2. **"Is this a medical device? Does the warning count as time-critical?"** Answer: we are a documentation and verification aid. The nurse decides, the allergy list is the chart's own, and nothing overrides or blocks. The Jan 2026 CDS guidance raises the time-critical question (Criterion 4). Counsel must confirm our position before any clinical rollout.
3. **"What is your security posture? Show me the MDS2."** Answer: we do not have one yet. The honest reply is that a real deployment needs a BAA, encryption, MDM, an MDS2 from the device maker plus our own, and a SOC 2 roadmap. Do not claim HIPAA compliance.
4. **"How do we clean it between patients?"** Answer: no published standard for smart glasses. We will take the M6 maker's written cleaning instructions and test them with infection prevention before pilot start. The NSW guidance is a start, not an answer.
5. **"Will it record patients and bystanders?"** Answer: the design does not store photos or audio on the glasses (per PITCH.md and README). The wound photo goes to the phone, not a gallery. A real deployment still needs a privacy review of the camera use and the signage rules. Verify the M6's camera and storage behaviour on the device first.
6. **"Will nurses actually wear it, and will it distract them?"** Answer: earlier nurse studies found sound quality and distraction issues (Denmark 2015; Japan 2026 snippet). Our pilot must measure distraction and nurse acceptance, not assume them.
7. **"Does it talk to Epic, and who maintains it?"** Answer: today it is a standalone prototype with synthetic data and no EHR connection. An Epic or FHIR path needs a SMART app registration and a security review; the timeline is uncertain. Do not claim integration.
8. **"What happens if the vendor leaves like Glass and HoloLens?"** Answer: this is the most damaging objection and the sources back it up. Our answer must cover the M6 maker's roadmap, support commitments and a phone-first fallback (BG-15) that keeps the work going without the glasses. Ask MicroLumin for written support terms.

## 6. Recommended pilot design (proposal)

This is our proposal, not a sourced standard. Thresholds below are hypotheses to agree with the hospital, not numbers from the literature.

- **Unit:** one adult med-surg unit, 24-30 beds, with a matched control unit of similar acuity and staffing model.
- **Devices:** 10-12 glasses plus phones; one device per nurse on the pilot shifts. Phone-only path in place for control.
- **Duration:** 2-week baseline, then 12 weeks of use. Total about 14-16 weeks including setup.
- **Governance:** quality-improvement determination or IRB, as the hospital requires. Nurse opt-in. Written intended use. Infection prevention and IT security sign-off before go-live.
- **Primary metric:** medication-administration interruptions per pass, observed directly (the outcome measures in the PITCH sources are direct observation).
- **Secondary metrics:** wrong-time and omission errors from direct observation; scan compliance (barcode use); documentation minutes per shift (time-motion or EHR audit log); near-miss reports; nurse-reported distraction and workload (validated short surveys); usability (SUS); device uptime and connectivity drops; cleaning compliance; glasses-to-phone latency on real hardware.
- **Success thresholds (proposed):** no increase in safety events against control; non-inferior or better scan compliance; a measured minutes-per-shift number with a confidence interval; no infection-prevention failures; at least 70% of enrolled nurses using the device on most shifts. The sponsor sets final thresholds before go-live.
- **Stop rules:** any safety event linked to the device, a failed cleaning check, or a security finding stops the pilot.

## 7. What to say to the glasses CEO

What the sources support:
- Hospitals buy through committees with IT security and infection-prevention review, so the sale is a **multi-stakeholder process**, not a single CNO signature. [S] (section 1)
- Earlier headset programs stalled on **vendor exit and support**, not only on price. A buyer will ask for support commitments first. [S] (Glass, HoloLens)
- Hospital nursing AR evidence is small and mostly from single sites. A pilot with real measured data is the asset. [P/S] (section 4)
- The market is a **small, uncertain** niche: estimates for healthcare AR glasses run from about $170M to $350M in 2025, and broader medical smart glasses from $1.8B to $2.6B (analyst estimates, definitions vary). [V]

Units and revenue angles (assumptions unless sourced):
- **Pilot unit:** 10-12 devices per unit (our proposal, section 6). Units per hospital after a pilot depends on how many units adopt. **Assumption:** 2-5 units per system in year one. No source.
- **Recurring revenue:** possible angles are device-management and support subscriptions, software licences per device, and a service contract. **No sourced price exists.** State these as assumptions, and ask MicroLumin for its pricing model before the pitch.
- **Do not claim:** EHR integration, HIPAA or FDA status, measured time savings, or hospital partners. None is sourced.

Suggested framing for the CEO: "We are asking for a pilot-ready M6 configuration and written support terms, not a sale. The first hospital buys ten devices and a support contract, and the pilot data decides the next step." Get the support terms in writing before the pitch.

## 8. Sources table

| # | Source | URL | Date read | Tag | Used for |
|---|---|---|---|---|---|
| 1 | BLS Occupational Outlook, RNs | https://www.bls.gov/ooh/healthcare/registered-nurses.htm | 2026-11-21 | P | Pay, jobs, hospital share, growth |
| 2 | AHA Fast Facts on US Hospitals 2026 | https://www.aha.org/statistics/fast-facts-us-hospitals | 2026-11-21 | P | Hospital and bed counts |
| 3 | Covington, FDA CDS guidance (Jan 2026) | https://www.cov.com/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance | 2026-11-21 | S | CDS guidance issue date and changes |
| 4 | FDA CDS guidance (primary) | https://www.fda.gov/media/191561/download | not opened | P | Listed only |
| 5 | HHS cloud FAQ (BAA) | https://www.hhs.gov/hipaa/for-professionals/faq/2075/may-a-hipaa-covered-entity-or-business-associate-use-cloud-service-to-store-or-process-ephi/index.html | 403, snippet only | P | BAA statement |
| 6 | HHS/ONC mobile device fact sheet | https://www.hhs.gov/guidance/document/fact-sheet-managing-mobile-devices-your-health-care-organization | snippet only | P | MDM |
| 7 | ANSI/NEMA HN 1-2019 (MDS2) | https://webstore.ansi.org/standards/nema/ANSINEMAHN2019 | 2026-11-21 | P | Device security form |
| 8 | HHS 405(d) pulse check | https://405d.hhs.gov/Documents/405d-network-connected-medical-device-security-pulse-check_R.pdf | snippet only | P | MDS2 use in procurement |
| 9 | HL7 SMART App Launch 2.2.0 | https://hl7.org/fhir/smart-app-launch/ | 2026-11-21 | P | SMART standard and version |
| 10 | MITRE/ONC SMART on FHIR Epic testing (2019) | https://oncprojectracking.healthit.gov/wiki/download/attachments/101613598/SMART%20on%20FHIR%20Epic%20Testing%20and%20Approvals.pdf | snippet only | P (dated 2019) | Epic approval timing and fees (stale) |
| 11 | NSW CEC VR headset cleaning guideline | https://www.cec.health.nsw.gov.au/__data/assets/pdf_file/0005/925385/Information-for-HWs-Cleaning-and-disinfecting-virtual-reality-equipment-v3.0.pdf | snippet only | P | Head-worn device cleaning |
| 12 | Symplr VAC toolkit | https://www.symplr.com/hubfs/Hospital%20Value%20Analysis%20Toolkit.pdf | snippet only | V | 45-day VAC claim |
| 13 | Worldhealthexpo, VAC description | https://www.worldhealthexpo.com/insights/healthcare-management/developing-effective-value-analysis-committees | snippet only | S | Committee roles |
| 14 | 9to5google, Glass Enterprise discontinued | https://9to5google.com/2023/03/15/google-glass-enterprise-edition-discontinued/ | snippet only | S | Glass end dates |
| 15 | RoadtoVR, HoloLens 2 discontinued | https://roadtovr.com/microsoft-hololens-2-discontinued-support-2027-hololens-3/ | snippet only | S | HoloLens 2 dates |
| 16 | Springer abstract, Glass in ED nurses (Denmark 2015) | https://www.springermedizin.de/can-google-glass-facilitate-work-for-nurses-in-the-emergency-dep/9667436 | snippet only | S | Nurse sound and usability |
| 17 | JMIR mHealth 2017, Google Glass systematic review | https://mhealth.jmir.org/2017/10/e159/PDF | snippet only | P | Satisfaction in 11/30 studies |
| 18 | Computer Weekly, NHS North Tees RealWear | https://www.computerweekly.com/news/366554934/North-Tees-and-Hartlepool-NHS-Trust-uses-RealWear-headsets-for-training | snippet only | S | RealWear use case |
| 19 | Vuzix MERGE case study | https://www.vuzix.com/blogs/case-studies/merge-solutions-vuzix | snippet only | V | Vuzix surgery case |
| 20 | PMC12234398, Hangzhou ED smart glasses cohort | https://pmc.ncbi.nlm.nih.gov/articles/PMC12234398 | snippet only | P | ED time reduction, single site |
| 21 | PubMed 42364464, prehospital smart glasses pilot | https://pubmed.ncbi.nlm.nih.gov/42364464/ | snippet only | P | EMS simulation |
| 22 | VR.org, Vision Pro surgery study | https://vr.org/articles/vision-pro-surgery-study-19-percent-faster-2026 | snippet only | S | Surgery time, single site |
| 23 | Healthcare IT News, Corewell ambient AI | https://www.healthcareitnews.com/news/corewell-healths-ambient-ai-cuts-nursing-documentation-time-52 | snippet only | S | Nursing ambient AI pilot |
| 24 | Persistence Market Research, medical smart glasses | https://www.persistencemarketresearch.com/market-research/medical-smart-glasses-market.asp | snippet only | V | Market estimate |
| 25 | Intel Market Research, healthcare AR glasses | https://www.intelmarketresearch.com/healthcare-ar-glasses-market-42189 | snippet only | V | Narrow market estimate |
| 26 | GII Research, healthcare AR glasses | https://www.giiresearch.com/report/ires2136931-healthcare-ar-glasses-market-global-forecast.html | snippet only | V | Narrow market estimate |
| 27 | ClinicalTrials.gov NCT07456241 | https://clinicaltrials.gov/study/NCT07456241 | snippet only | P | Ambient AI RCT registry |

## Unverified / not found

- Bedside RN count (no BLS or AHA split found).
- Hospital-specific RN median of $100,220 (formerly in PITCH.md; removed, never found in the BLS page).
- Price points hospitals pay for RealWear, Vuzix, Glass Enterprise, HoloLens 2 or the M6.
- Any hospital nursing smart-glasses contract size, or any 2025-2026 nursing rollout of a glasses product at scale.
- Current Epic App Orchard or Showroom requirements, fees and review timelines (login-gated; only 2019 data).
- Any published VAC, CMIO, CNO or IT security review duration.
- Cleaning or disinfection guidance for smart glasses specifically.
- FDA's position on head-mounted display software; no source found.
- The HHS cloud FAQ and mobile-device fact sheet were read from search snippets only (HHS cloud page returned 403).
- The Japanese 2026 nurse usability study (5 nurses): no URL recorded.
- The Stanford SnapCap PLOS ONE 2015 study: URL not recorded.
- Who holds the budget for a nursing device in a typical US system.
- Whether the M6 has a camera-storage policy, battery life or cleaning instructions (device-side questions for MicroLumin).
- The CMAJ commentary dates and the Duke VAC page (snippets only).
- Meta: no hospital nursing deployment found.
