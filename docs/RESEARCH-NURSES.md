# Nurse use case research: bedside medication pass and handoff

Read 2026-11-21. Scope: medical-surgical bedside nursing, medication administration, shift handoff, and what nurses say about wearables and voice tools. Bedside Glance is a documentation and handoff aid with synthetic demo data only. Nothing here is clinical or regulatory advice.

Tags: [P] primary (journal, regulator, professional body, primary text), [S] secondary (review, news, summary, search snippet), [V] vendor, survey firm or marketing, [U] unverified or our own inference. Where a figure came only from a search snippet (full text not opened), it is marked "snippet".

Overlap with existing notes: [docs/STORY-RESEARCH.md](STORY-RESEARCH.md) (interruptions, Debono 2025, KLAS charting figure, NSI turnover cost, Zhang 2022 EMS glasses) and [docs/HYDROGEL-RESEARCH.md](HYDROGEL-RESEARCH.md) (wound documentation, FDA image-analysis caution). Those are not repeated here except where a correction is needed.

## Corrections to existing docs

- **Ancker 2017 venue.** `docs/STORY-RESEARCH.md` and `README.md` do not cite it, but it is easy to repeat: Ancker et al. 2017 is in *BMC Medical Informatics and Decision Making* 17:36, DOI 10.1186/s12911-017-0430-8 (not BMJ Quality & Safety). Source: https://dblp.uni-trier.de/rec/journals/midm/AnckerENHMK17.html, read 2026-11-21 [S].
- **Keers 2013 figures.** `README.md` says median 19.6% of opportunities for error, and 8.0% when wrong-time errors are excluded. I could not verify either number. The review is Keers et al., Ann Pharmacother 2013;47(2):237-256 (doi 10.1345/aph.1R147), and the snippet says "roughly one in five" doses, mostly timing errors. Resolved: README, PITCH and decks no longer quote 19.6% / 8.0%; they say roughly one in five, mostly timing errors, from a secondary summary. PubMed pages were blocked for our fetch tool. [S, snippet]
- **66% workaround figure (resolved 2026-11-21).** It belongs to van der Veen et al., J Am Med Inform Assoc 2018;25(4):385-392 (online Aug 2017), PMC7646849, not to the 2020 J Clin Nurs paper (PubMed 32043705). The abstract says 66%; the results give 3,633 of 5,793 administrations (63%). The 36% is the share of workarounds that were procedural (such as not scanning at all, n=1307), not the share of administrations with a skipped scan. [S, full text read]
- **Interruption figure** (Westbrook 2010, 53.1% of 4,271 administrations) is already in the README and STORY note, and is consistent with what I found. Not re-verified here. [S]

## 1. A day in the life of a medical-surgical bedside nurse

### Patient ratios

- **California is the only US state with a mandated med-surg ratio:** 1:6 phased from 2004, tightened to 1:5 in March 2005 (Becker's summary, https://www.beckershospitalreview.com/quality/nursing/californias-mandatory-nurse-staffing-ratios-key-lessons-2-decades-in/, read 2026-11-21) [S].
- **Mortality evidence is mixed.** Aiken et al. 2010 compared California with New Jersey and Pennsylvania and estimated 13.9% and 10.6% fewer deaths if those states matched California's limits. Later California-specific analyses (Spetz and colleagues) found mixed quality effects, with the authors noting "no consistent evidence" of outcome improvement in hospitals that were already poorly staffed (same Becker's summary) [S]. Implication for us: do not claim ratio effects; cite the mixed evidence if asked.
- **Research benchmark, not US practice:** a 2025 British Columbia secondary analysis suggests a minimum of 1:4 for med-surg (search snippet; full text not read) [S].
- **McHugh et al. thresholds** (1:4 on day and evening, 1:7 at night, linked to better outcomes) are cited by Leapfroggroup's 2025 factsheet (https://ratings.leapfroggroup.org/sites/default/files/2025-03/2025%20Nursing%20Workforce%20Factsheet.pdf). The wording was truncated in our search result. Verify before quoting [S].
- **Unit-level data:** Brigham and Women's reported roughly 1:1.07 on one med-surg unit in Q4 2025 (https://www.brighamandwomens.org/assets/BWH/medical-professionals/nursing/pdfs/bwh-nurse-to-patient-ratios-q4-2025.pdf, snippet) [V, one unit at one hospital, not typical].
- **Not found:** a national US average med-surg ratio for 2025. Next source to check: AHRQ or NDNQI data, or the Texas Hospital Nurse Staffing Survey full report [U].

### Time split

The studies disagree because they define "direct care", "documentation" and "medication" differently. Ranges, not single numbers:

| Source | Setting and method | Documentation | Medication administration | Direct care |
|---|---|---|---|---|
| Battisto et al. 2009 (job task analysis, summary) | Med-surg, large community hospital | about 25% | not given | about 55% |
| Acute-care PDA time study (summary; year not confirmed) | Acute care, timed by device | 35.3% (147.5 min) | 17.2% (72 min) | care coordination 20.6% |
| J Clin Nurs 2023 (summary) | Acute and subacute medical wards | not given | about 3% | about 27% |
| McKinsey/ANA survey | Self-reported, 12-hour shifts | about 15% | not given | about 54% (survey, not observed) [V] |

Sources: Battisto 2009 and the PDA study via a search summary of PMC3037121 and PMC5890532; J Clin Nurs 2023 via https://journalclub.wustl.edu/2023/07/25/understanding-the-workflow-of-nurses-in-acute-and-subacute-medical-wards-a-time-and-motion-study/; McKinsey https://www.mckinsey.com/industries/healthcare/our-insights/reimagining-the-nursing-workload-finding-time-to-close-the-workforce-gap, all read 2026-11-21 [S] unless marked. Full texts not opened.

Takeaway: documentation is roughly 14-35% of shift time depending on the study, and medication administration is a few percent to about 17%. Observational studies report less documentation time than surveys do [S].

### Searching for equipment and supplies

- **Nursing Times (Ford 2009, via AAFP):** more than one-third of nurses spend an hour or more per shift searching for equipment (AAFP, https://www.aafp.org/pubs/fpm/blogs/inpractice/entry/medical_supplies_equipment.html, read 2026-11-21) [S, secondary citation of a trade article].
- **GE HealthCare study (via HIMSS):** 21 minutes per shift searching for lost equipment; a Buffalo health system estimated 57 minutes including cleaning equipment [V].
- **McKinsey/ANA survey:** about 6% of a 12-hour shift on "hunting and gathering" (people, equipment, supplies, medications, information) [V, survey].
- **Infor survey:** 32% of nurses spend over 20 minutes per shift searching for supplies [V].
- **Walking distance in miles:** not found in any peer-reviewed source [U].

### Shift change and handoff

Practices in use: SBAR, I-PASS, and bedside shift report (both nurses at the bedside, reviewing medications, pumps and allergies).

- **I-PASS.** Starmer et al., N Engl J Med 2014;371:1803-1812. Nine pediatric residency programs, 10,740 admissions. Preventable adverse events fell from 4.7 to 3.3 per 100 admissions (about 30%, P<0.001). Medical errors fell from 24.5 to 18.8 per 100 admissions (about 23%). Nonpreventable events did not change (secondary summary of the paper, AHRQ PSNet and Boston Children's coverage, read 2026-11-21) [P for the design, S for the figures]. Caveats: pediatric residents, not nurses; the lead author has ties to the I-PASS Patient Safety Institute. Do not use the 47% figure that some summaries cite; it comes from a different study (not Starmer 2014) and is not used anywhere in this repo.
- **SBAR.** Making Healthcare Safer IV rated SBAR as low certainty for patient safety outcomes and I-PASS as moderate [S]. A 2018 BMJ Open review found moderate evidence for SBAR, mostly in phone handover (https://read.qxmd.com/doi/10.1136/bmjopen-2018-022202) [S].
- **Bedside report.** Evidence is weak. The claim that errors occur less often with two nurses at the bedside comes from a 2026 student thesis, and Wolters Kluwer's pieces are educational [V]. Do not claim bedside report reduces errors [U].

Failure modes found in qualitative work (abstracts and snippets, full texts not opened) [S]:

- **Information loss and unplanned work.** A Purdue dissertation (focus groups with 21 nurses, FMEA) found an early handoff failure set off a chain of later problems and forced unplanned work on the incoming nurse. Medical-surgical handoffs cover about four or more patients (https://docs.lib.purdue.edu/dissertations/AAI10270094).
- **Mismatched expectations.** Incoming nurses want a dialogue; outgoing nurses want to give their account without interruption. Nurses' view of information adequacy did not match expert ratings (multi-method study, index 3-2 and 3-3 via search summary).
- **Individual preference drives content.** Focus groups with 34 critical care nurses found individual preference strongly shaped what was handed over (search summary).
- **Unstructured content and weak question-and-answer steps** are the main drivers of information gaps (qualitative literature summary).
- **Hemodialysis units** lacked a standard handoff and saw an unstandardised content risk (exploratory qualitative, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12334133/) [S].

## 2. Medication administration

### BCMA adoption and workarounds

- **Koppel et al. 2008.** JAMIA 15(4):408-423, DOI 10.1197/jamia.M2616, published 1 July 2008. Two hospitals observed and shadowed, five interviewed, override logs analysed. Nurses overrode the scanning system for 4.2% of patients charted and 10.3% of medications charted. The authors identified 15 workaround types and 31 causes, such as unreadable or covered barcodes and malfunctioning scanners. Most workarounds came from poor process design. Four hospitals that followed the recommendations cut workarounds sharply. Read in abstract, https://academic.oup.com/jamia/article/15/4/408/731255, 2026-11-21 [P].
- **Workaround prevalence.** 66% of administrations had a workaround per the abstract (63% in the results table), the most common being procedural ones such as not scanning (van der Veen et al., JAMIA 2018, PMC7646849) [S]. The UK teaching hospital evaluation reported 95% of 255 scannable doses verified (2020, snippet) [S]. Scan rates vary widely by setting [S].
- **van der Veen et al. 2020,** J Clin Nurs, four Dutch hospitals. Workarounds were linked to late-afternoon and evening rounds (6pm-10pm adjusted OR 3.60, 95% CI 2.11-6.14; 2pm-6pm OR 1.60, 95% CI 1.05-2.45). The authors name nurse workload and patient-to-nurse ratio as the modifiable factors (PubMed snippet; abstract page blocked) [S].
- **Systematic review:** a 2013 review (Voshall et al., J Nurs Adm) covers BCMA workarounds (search snippet) [S]. No 2024 systematic review was found [U].

### Rights, identifiers and error types

- **Two-identifier rule.** The Joint Commission's NPSG.01.01.01 requires at least two patient identifiers when administering medications. Room number is explicitly not an identifier. For home care, facial recognition can count as one identifier in ongoing care, but not on first visits (Joint Commission FAQs and the NPSG chapter for hospitals, https://jointcommission.org/-/media/tjc/documents/standards/national-patient-safety-goals/2024/npsg_chapter_hap_jan2024.pdf, read 2026-11-21) [P]. Check the current edition before quoting exact wording; the sources span several manuals.
- **Five rights** (right patient, drug, dose, route, time) are the core teaching framework, but one NCBI chapter says error rates have not dropped significantly since they were introduced, and PSNet says following them does not by itself guarantee safe administration (https://www.ncbi.nlm.nih.gov/books/NBK560654/, PSNet primer) [P/S].
- **Error rates.** PSNet's primer (updated March 2021) cites a review of 91 direct-observation studies: median administration error rates 8%-25%; IV administration 48%-53% including timing errors. It does not say whether the 8%-25% figure includes timing errors. It cites wrong dose, missed doses and wrong medication as the most common reported error types (https://psnet.ahrq.gov/primer/medication-administration-errors, read 2026-11-21) [S]. The primer's wording on the most common types is about the outside-hospital setting, so it is not a clean inpatient statement.
- **Keers 2013** (see corrections): most inpatient errors are timing errors, not wrong-dose or wrong-drug errors (snippet) [S].
- **Interruptions.** Westbrook 2010 (in STORY note) and a multi-hospital survey where about 63% of respondents said interruptions during administration were a factor (PMC7764714, snippet) [S].

### Alert fatigue and workload

- **Ancker et al. 2017** (BMC Med Inform Decis Mak 17:36): 112 ambulatory primary-care clinicians, EHR data 2010-2013. Alert acceptance fell with repeated alerts for the same patient; workload alone did not predict it. Nurse practitioners accepted drug alerts about four times as often as physicians (secondary summary) [S].
- **Alarms.** A survey of 100 critical care nurses named continual beeping alarms as the top noise source (snippet). ICU, not med-surg. ECRI's 2026 top-10 list starts with AI chatbot misuse; I could not confirm whether alarms appear on the 2025 or 2026 lists [U].

## 3. What nurses say about wearables, glasses and voice

- **Smart glasses in care work.** A 2023 PRISMA systematic review of 21 studies (JMIR Med Inform, e44161, https://medinform.jmir.org/2023/1/e44161/PDF) found acceptance and benefits, and barriers in technical limits, human factors and ergonomics, privacy and security, and organisation [S]. Weight and battery were not confirmed as barriers in the snippets I saw; check the full text [U].
- **Urgent care triage (2024, mixed methods, BMC Nursing).** Nurses were satisfied, rated ease of use highly, and reported better communication (https://doaj.org/article/ce590450426c42059ca7853f1a679042, snippet) [S].
- **Home and remote wound care (2025, qualitative, Vuzix M400).** Long-term users reported more feedback between nurses and patients, and task shifts (snippet) [S].
- **Anaesthesia focus groups (2025 simulation).** Mostly positive but cautious; themes were monitoring impact, usability, and communication (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12670854/, snippet) [S].
- **2025 mixed-methods systematic review (eight studies, smart glasses and mobile apps)** found poor interface design and weak workflow integration as adoption barriers (PMC12489439, snippet) [S].
- **Google Glass in ED** (PMC4511400): a pilot abstract noted sound quality affected usability ratings (snippet) [S]. Earlier small Glass wound-care pilot (16 nurses, PLoS ONE 2015) found barcode patient ID preferred (from STORY note) [S].
- **EMS privacy concern** (Zhang et al., JMIR Hum Factors 2022, n=13): concerns that recordings could be used "against you" (from STORY note) [S].
- **Patient views of nurses using devices at the bedside.** McNicol 2018 (Patient Experience Journal), 24 ward patients: they recognised benefits but wanted more engagement with nurses, and some said devices impeded communication (https://doaj.org/article/9e2d13e0ff8f41ee94b235e9c5aa81a2, abstract) [S]. Micro-ethnography of nurses' "game of tag" between patient and screen (search summary) [S].
- **Hidden work.** A Taiwanese qualitative study found nurses look after patients and computers as "co-clients", and managing technical faults is an unintended cost (search summary) [S]. A longitudinal study found nurse dissatisfaction peaked about 9 months after EHR implementation and was more balanced by 18 months [S].
- **Noise.** Measured pediatric ICU levels of 60-70 dBA baseline and peaks to 120 dBA, with staff conversation the largest peak source (snippet) [S]. The WHO guideline cited there is 30 dB(A) at night and 35 dB(A) by day [S]. Nurse surveys name alarms as the main noise disturbance [S]. Med-surg ward noise data: not found [U].
- **Voice documentation.** A systematic review (Joseph et al. 2020) found accuracy varied with software and microphones [S]. Everett et al. 2022 found less flowsheet time, but did not measure satisfaction or accuracy [S]. A 2023 cross-sectional study (Dinari et al.) ranked concerns: lack of trained staff and recognition accuracy for accents, slang and women's voices [S]. A 2026 German long-term-care study reported less self-reported documentation time (not hospital) [S].
- **Glove use, infection control and device cleaning.** No source found on glove use with smart glasses or cleaning protocols for them. An ophthalmic-surgery policy template says stop recording when it creates an infection-control concern (https://www.accountablehq.com/post/hipaa-compliant-smart-glasses-recording-policy-template-for-ophthalmic-surgery-centers) [V]. **Gap.** Ask infection prevention before any glasses use near the bedside.
- **Recording and policy.** Several health systems ban unapproved smart glasses (Becker's, FMOL Health, https://www.beckershospitalreview.com/healthcare-information-technology/innovation/smart-glasses-spotlight-privacy-blind-spots-in-healthcare/, read 2026-11-21) [S]. A MedPro risk Q&A recommends naming smart glasses in policy, signage, discipline, and staff training to spot recording devices (https://resource.medpro.com/documents/10502/3019648/Risk+Q%26A_Smart+Glasses+in+Healthcare+Facilities_MedPro+Group.pdf) [V, insurer guidance]. Legal commentary (WTW 2026) says these devices fall under HIPAA, wiretap and biometric laws rather than a device-specific rule [S].

## 4. Burnout and turnover drivers relevant to tool design

- **Documentation burden and turnover (2026, peer-reviewed).** Xia et al., JMIR Nursing 2026, DOI 10.2196/89645 (https://nursing.jmir.org/2026/1/e89645): 432 med-surg and surgical RNs at one academic centre in 2022; 6,812 shifts; about 13 million EHR audit actions; 84 nurses (19%) left. A higher share of medication administration actions was linked to higher odds of turnover (OR 2.20, 95% CI 1.36-3.54); greater alert engagement was linked to lower odds (OR 0.48, 95% CI 0.32-0.72). Read from search snippets; the full-text fetch failed [S, observational, one site].
- **KLAS/Arch 2025** (n=80,147; via HIT Consultant, Dec 2025): 40% of nurses intend to leave the profession by 2029; burnout reported by 46% of nurses spending 3+ hours a shift on unproductive charting, versus 21% under one hour (secondary summary; not read in original) [V, survey].
- **Black Book, May 2025** (over 9,000 US nurses): 69% say documentation burden and poor EHR usability contribute to job dissatisfaction [V, survey, vendor-adjacent].
- **Turnover cost:** $60,090 per bedside RN (NSI 2026, from the existing README) [V].
- **Earlier cross-sectional survey** (PMC, pre-2025): documentation burden weakly to moderately correlated with burnout, and EHR usability linked to both (search summary) [S].

## 5. UX requirements that follow, with evidence

| Requirement | Evidence | Tag |
|---|---|---|
| Glanceable, one line per fact; no stacked text | Nurses' attention is shared between patient and screen (micro-ethnography, game of tag). The one-second rule is our inference, not a measured threshold | [S] and [U] |
| Minimal alerts; no repeats for the same patient | Ancker 2017: repeats lower acceptance, workload does not | [S] |
| No auto-pop-ups in the central clear zone during a med pass | Interruptions linked to more errors (Westbrook 2010) | [S] |
| Hands-free confirmation with a visible read-back | Voice documentation accuracy varies; hands and gloves limit touch input | [S] and [U] for gloves |
| One-handed phone use | No source found | [U] |
| Offline tolerance with a visible queued state | Handoff and workflow failures from unreliable systems; no nurse-specific offline study found | [S] and [U] |
| Low charting time | Documentation share of shift; turnover association | [S] and [V] |
| Privacy: no recording stored, visible capture indicator | Policy and legal commentary; patient-engagement concerns | [V] and [S] |
| Structured handoff content with fixed fields | I-PASS (pediatric, 30% fewer preventable events); SBAR low certainty | [P]/[S] |

## 6. Mapping our features to documented pain

Our features are taken from `README.md`. I did not re-read the FRD in this pass.

| Documented pain | Evidence | Our feature | Gap |
|---|---|---|---|
| Interruptions during administration | Westbrook 2010; 63% survey | Meds card on wristband scan, one-tap or voice "done" | Each HUD update is an interruption; no measured count per pass |
| Scanning workarounds | Koppel 2008: 4.2% patients, 10.3% medications | Wristband scan to open the meds card | README does not describe a drug-label scan; confirm before claiming "right drug" |
| Logging without a second check | Five rights do not guarantee safety; timing errors | "done" logs the dose, shows `{time} · via glasses` | A bare "done" can log the wrong dose; no drug/dose read-back in the README |
| Alert fatigue, repeats | Ancker 2017 | Critical allergy needs acknowledgement; PRN card | Repeat-alert count per patient not measured |
| Handoff loss, unstructured content | Purdue FMEA; I-PASS | Wound send to Dr. Okafor; activity feed | No structured shift handoff card (I-PASS fields) |
| Charting burden | KLAS 2025; JMIR 2026 turnover | Dressing fields, wound draft note, voice | No time-saved measurement; no EHR integration |
| Noise and comms | ICU noise surveys | Voice in, HUD out | No ward-noise test; voice may fail in noise |
| Wearables privacy | Policy bans, EMS concern | No frame storage (claimed in demo) | Consent script and capture indicator not in README |
| Infection control | No source | Glasses worn at bedside | No gloves or cleaning plan |
| Wound AI and image analysis | FDA CDS guidance (HYDROGEL note) | Labelled AI draft, "documentation aid" | Still an image-analysis risk; keep labels, no severity |

### The five biggest gaps or risks an informatics nurse would raise

1. **Voice "done" without a read-back.** A nurse could log the wrong dose from a bare confirmation. Fix (buildable now): on "done", the glasses read back patient name, drug and dose, and require a second confirm; never log if two wristbands are in frame. Test: a failing test where a mismatched card must not log.
2. **Recording and bystander privacy on glasses.** Wristbands and screens in frame, and bystander faces. Fix: no frame storage (verify in code), visible capture indicator on the HUD, a patient-facing consent script on the phone, and a policy checklist. Test: confirm the mirror and stage view shows no PHI.
3. **HUD interruptions and alert fatigue.** Each new card during a pass is an interruption, and repeats for the same patient lower acceptance. Fix: cap cards per pass, no repeat cards for the same patient unless the state changes, and log the count so we can report it. Test: a per-pass count assertion.
4. **Offline and sync conflicts.** First-write-wins can show "Already given", and a queued dose may look charted when it is not. Fix: show "Queued" clearly on both devices and test the reconnect order. Never say "charted" until the server acknowledges.
5. **Wound image analysis.** This is still an image-analysis risk under FDA's January 2026 CDS guidance (HYDROGEL note). Fix: keep the AI label, the documentation-aid line, no severity or infection output, and a regulatory-assessment note in the pitch.

Also unaddressed: gloves and device cleaning (no source), ward noise (ICU data only), no EHR or BCMA integration (synthetic data), and no structured shift handoff. Mention these as roadmap items, not claims.

## 7. Ten interview questions for a real nurse tomorrow

1. Walk me through your last medication pass, step by step. What did you scan, and what interrupted you?
2. When a wristband or drug barcode will not scan, what do you do, and how often does it happen?
3. Which alerts did you override this week, and why?
4. How much time after your shift goes to charting you would not need if the information were already on screen?
5. Show me how you find a supply or piece of equipment on a typical shift. How long did the last search take?
6. What does bedside handoff look like on your unit, and what information gets lost?
7. Would you wear glasses while doing wound care or with gloves on? What would make you take them off?
8. How do patients react when you look at a screen or device during care?
9. What would make you stop using a new tool within a week?
10. If a tool showed a dose due, would you rather confirm the patient, drug and dose out loud or on screen? Why?

## Sources (read 2026-11-21 unless stated)

| Source | URL | Tag |
|---|---|---|
| Becker's, California ratios (2 decades) | https://www.beckershospitalreview.com/quality/nursing/californias-mandatory-nurse-staffing-ratios-key-lessons-2-decades-in/ | S |
| Leapfroggroup 2025 nursing workforce factsheet | https://ratings.leapfroggroup.org/sites/default/files/2025-03/2025%20Nursing%20Workforce%20Factsheet.pdf | S |
| Time-use summaries (Battisto 2009, PDA study) | PMC3037121, PMC5890532 (search summaries) | S |
| J Clin Nurs 2023 time-motion summary | https://journalclub.wustl.edu/2023/07/25/understanding-the-workflow-of-nurses-in-acute-and-subacute-medical-wards-a-time-and-motion-study/ | S |
| McKinsey, nursing workload | https://www.mckinsey.com/industries/healthcare/our-insights/reimagining-the-nursing-workload-finding-time-to-close-the-workforce-gap | V |
| AAFP summary of Nursing Times equipment search | https://www.aafp.org/pubs/fpm/blogs/inpractice/entry/medical_supplies_equipment.html | S |
| Starmer et al., NEJM 2014 (I-PASS) | https://psnet.ahrq.gov/resource/28485 (summary) | P (design), S (figures) |
| BMJ Open 2018, SBAR systematic review | https://read.qxmd.com/doi/10.1136/bmjopen-2018-022202 | S |
| Purdue dissertation, handoff FMEA | https://docs.lib.purdue.edu/dissertations/AAI10270094 | S |
| Hemodialysis handoff, qualitative | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12334133/ | S |
| Koppel et al. 2008, JAMIA 15(4):408-423, doi 10.1197/jamia.M2616 | https://academic.oup.com/jamia/article/15/4/408/731255 | P (abstract) |
| van der Veen et al. 2020, J Clin Nurs (PubMed 32043705) | https://pubmed.ncbi.nlm.nih.gov/32043705/ (blocked; snippet) | S |
| Joint Commission NPSG chapter, hospital, Jan 2024 | https://jointcommission.org/-/media/tjc/documents/standards/national-patient-safety-goals/2024/npsg_chapter_hap_jan2024.pdf | P |
| NCBI NBK560654 (five rights) | https://www.ncbi.nlm.nih.gov/books/NBK560654/ | P/S |
| PSNet primer, medication administration errors (updated Mar 2021) | https://psnet.ahrq.gov/primer/medication-administration-errors | S |
| Keers et al. 2013, Ann Pharmacother 47(2):237-256, doi 10.1345/aph.1R147 | https://pubmed.ncbi.nlm.nih.gov/ (blocked; snippet) | S |
| Ancker et al. 2017, BMC Med Inform Decis Mak 17:36 | https://dblp.uni-trier.de/rec/journals/midm/AnckerENHMK17.html | S |
| 2023 smart glasses systematic review, JMIR Med Inform e44161 | https://medinform.jmir.org/2023/1/e44161/PDF | S |
| BMC Nursing 2024, smart glasses urgent-care triage | https://doaj.org/article/ce590450426c42059ca7853f1a679042 | S |
| Anaesthesia smart glasses focus groups 2025 | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12670854/ | S |
| Mixed-methods systematic review 2025 | https://pmc.ncbi.nlm.nih.gov/articles/PMC12489439 | S |
| McNicol 2018, Patient Experience Journal (patients and bedside technology) | https://doaj.org/article/9e2d13e0ff8f41ee94b235e9c5aa81a2 | S |
| Noise in ICU wards (Saudi cardiac ICU, PMC6901058) | https://pmc.ncbi.nlm.nih.gov/articles/PMC6901058 | S (snippet) |
| Joseph et al. 2020 voice documentation systematic review | snippet only | S |
| Xia et al. 2026, JMIR Nursing e89645, EHR workload and turnover | https://nursing.jmir.org/2026/1/e89645 | S (snippet) |
| KLAS/Arch 2025 via HIT Consultant (Dec 2025) | https://hitconsultant.net/2025/12/17/40-of-nurses-planning-to-quit-how-streamlined-ehr-workflows-can-save-the-profession/ | V |
| Black Book Nurses' Week survey 2025 | https://www.newswire.com/news/nurses-continue-to-name-ehrs-a-top-driver-of-burnout-and-resignation-22574611 | V |
| Becker's, smart glasses privacy blind spots | https://www.beckershospitalreview.com/healthcare-information-technology/innovation/smart-glasses-spotlight-privacy-blind-spots-in-healthcare/ | S |
| MedPro risk Q&A, smart glasses in healthcare facilities | https://resource.medpro.com/documents/10502/3019648/Risk+Q%26A_Smart+Glasses+in+Healthcare+Facilities_MedPro+Group.pdf | V |
| WTW 2026, AI wearables in healthcare | https://www.wtwco.com/en-us/insights/2026/07/through-a-new-lens-managing-the-risks-of-ai-wearables-in-healthcare | S |
| AccountableHQ, ophthalmic recording policy template | https://www.accountablehq.com/post/hipaa-compliant-smart-glasses-recording-policy-template-for-ophthalmic-surgery-centers | V |
| ECRI top 10 hazards 2026 | https://home.ecri.org/blogs/ecri-thought-leadership-resources/top-10-health-technology-hazards-for-2026-executive-brief | P (list), not read in full |
| FDA CDS guidance (Jan 2026) | https://www.fda.gov/media/109618/download | P (read in HYDROGEL note) |

## Unverified or not found

- **Not found:** a US national median med-surg ratio for 2025; any med-surg ward noise measurement; walking distance in miles for nurses; any study on glove use with smart glasses; any cleaning protocol for smart glasses; a 2024 BCMA systematic review; a nurse quote about charting after shift ("pajama time"); evidence that one-handed phone use affects nurse error.
- **Unverified figures:** Keers 19.6% and 8.0% (README); 47% I-PASS reduction (not from Starmer 2014, not used); 95% scan verification (UK 2020, snippet only); 63% interruptions (multi-hospital table, snippet); Ancker NP ratio of about 4x (secondary summary); Xia 2026 odds ratios (snippet, full text not read); KLAS 46% vs 21% burnout split (secondary summary).
- **Full text not read:** most items above were read from abstracts, search snippets or secondary summaries. PubMed pages were blocked for the fetch tool; JMIR and PMC full-text fetches returned empty. Treat each tag as the lowest level of the source actually opened.
- **Not searched:** nurse-specific offline or connectivity studies; the 2025 ECRI list (alarm hazards); Oregon and other states' staffing laws; patient-consent law for recording by state.
