# Hydrogels and Bedside Glance: research note

Read and compiled 2026-11-21. Bedside Glance is a documentation aid, not a diagnostic tool, with synthetic demo data only. Nothing here is medical or regulatory advice.

Evidence tags used below:
- [P] primary source (journal, FDA, guideline text read directly)
- [S] secondary (review, search-result summary, news; not read in full)
- [V] vendor marketing, patent or preprint (not peer reviewed)
- [U] unverified: stated from general knowledge, check before saying aloud

Method note: findings come from web searches on 2026-11-21 plus one primary document read in full (the FDA CDS guidance). Several items are search-result summaries, tagged [S]. Anything tagged [S] or [U] must not be quoted to reviewers as fact without a second look.

## 1. Short answer

A hydrogel is a water-rich dressing that nurses use to moisten dry or necrotic wounds. It is a dressing choice, not a sensor, and our product does not need hydrogel technology. What hydrogels give us is a realistic reason to capture a few structured fields in the wound flow (dressing type, change interval, next change due), which are things a nurse documents anyway. "Smart" sensing hydrogels are a research field, not a bedside product, and we should say so.

## 2. Hydrogel dressings in nursing practice

What they are and when they are used
- Hydrogels are used for dry, necrotic or sloughy wounds to rehydrate tissue and support autolytic debridement. They are not suited to moderate or heavily exuding wounds, and a secondary dressing is needed. Sources: DermNet professional page (https://pro.dermnetnz.org/procedures/dressings.html), WikEM dressing basics (https://wikem.org/wiki/Wound_care_dressing_basics), Wounds UK (https://wounds-uk.com/wp-content/uploads/2023/02/content_10820.pdf), via search summaries read 2026-11-21. [S]

How often changed
- I found no hydrogel-specific interval in a formal guideline. The general principle in the sources is that change frequency depends on exudate volume and the dressing's capacity, and a hydrogel has little absorptive capacity, so the interval is usually set by the secondary dressing and the facility protocol plus the product label. [S] Do not hard-code an interval as clinical truth. The demo's "Changed 9:00 AM, due 9:00 PM" (FRD G7) is a synthetic example and should be labeled as such. [P, our own FRD]

What nurses document (consolidated from the framework sources below; confirm against the unit's policy)
- Dressing type and product, date and time of change, next change due.
- Wound bed (tissue type: necrotic, slough, granulation, epithelial), size, exudate amount and type, periwound skin, odor, pain, signs of infection, and who was told. This list is my synthesis of the TIME and PUSH domains, not a quote from one standard. [U]

Assessment frameworks
- PUSH Tool 3.0 (NPIAP): scores surface area, exudate amount and tissue type, total 0 to 17 (0 is healed), used to track healing over time, weekly in the source summary. It does not capture odor, pain or bleeding. The tool PDF is labeled "Version 3.0: 9/15/98". Sources: https://www.sralab.org/sites/default/files/2017-06/push3.pdf and the NPIAP store page https://learn.npiap.com/products/push-tool-3, read 2026-11-21. [P for the tool and its version label, S for the reliability claims]
- TIME (tissue, infection/inflammation, moisture, edge): original concept from 2003; updated as TIME CDST (Dowsett et al., J Wound Care 2019;28(3):154-161) and extended to TIMERS (adds repair/regeneration and social factors). A 2025 Wounds International piece says the framework is underused in daily workflow. Sources: https://www.elft.nhs.uk/research/resource/time-cdst-updated-tool-address-current-challenges-wound-care-dowsett-2019 and https://woundsinternational.com/wp-content/uploads/2025/12/WINT-16-4_Pascal-_WEB-v2.pdf, read 2026-11-21. [S]
- Braden Scale: a pressure injury risk score, not a wound assessment. It is relevant to which patients need skin checks, not to hydrogel choice. I did not fetch a Braden source in this pass. [U]

Evidence that hydrogels work
- Cochrane reviews give weak evidence: for venous leg ulcers the effect versus gauze and saline is uncertain (very low certainty); for pressure ulcers it is unclear; the diabetic foot ulcer review (2013) suggested a possible benefit for lower-grade ulcers versus basic contact dressings. Source: https://cochranelibrary.com/cdsr/doi/10.1002/14651858.CD010738.pub2/information and related reviews, via search summary 2026-11-21. [S] Takeaway: do not claim hydrogels, or our product, improve healing.

## 3. Smart and sensing hydrogel dressings

Maturity
- Active research: pH-sensitive dye dressings, temperature and biomarker patches, smartphone colorimetric readout. A 2025 in vivo study of an alginate hydrogel dressing with a pH dye was done in mice and pigs, with a machine-learning smartphone app, and its authors say clinical application has not been achieved (https://pubmed.ncbi.nlm.nih.gov/40383028/). [S]
- A 2025 Purdue preprint lists barriers: scalability, poor integration with commercial dressings and interference from wound exudate (https://engineering.purdue.edu/StickTronics/wp-content/uploads/2025/08/2025-AHM-R2R.pdf). [V, preprint]
- A pH-sensing bandage preprint compared smartphone-camera readout with a homebuilt RGB detector (https://www.biorxiv.org/content/10.1101/2024.10.11.617850.full.pdf). [V, preprint]
- Commercial signals I found were a patent application (4M Biotech, color-changing pH dressing, via BioWorld, Jan 2024) and an August 2025 lab patch with pH, temperature and biomarker sensing (https://www.news-medical.net/news/20250806/Smart-wound-patch-detects-healing-progress-and-infection-risk.aspx). [V]

FDA status
- I found no FDA-cleared sensing or color-indicating wound dressing. The 510(k) database hits were plain or antimicrobial hydrogels (for example K172338, K240510), which are non-sensing. This was a web search, not a direct product-code search, so say "I found none", not "none exist". [S, absence of evidence]
- Plain hydrogel dressings are cleared as dressings under codes such as NAE (without drug), FRO (wound dressing with drug) and MGQ (hydrogel with drug or biologic); the exact code and class should be verified in FDA's database before citing. Sources: accessdata.fda.gov classification pages, via search summary. [S]

Honest evidence level: preclinical and early lab work; no randomized trial of a smart hydrogel dressing changing nursing outcomes was found.

## 4. Hydrogels in wearables, glasses and biosensors

- Hydrogel contact lenses for tear glucose and nose-pad eyeglass sensors for tear or sweat (printed electrodes plus microfluidics, not hydrogel) exist as research (PMC8372769 and related, via search summary). [S]
- Relevance to the MicroLumin M6 glasses: none that I can establish. We have no evidence that the M6 has a tear, sweat or skin-contact sensor, and our app does not read any. Hydrogel comfort pads for frames: I found no evidence. Verdict: not relevant, do not mention except to say we looked.

## 5. Product ideas, ranked by honesty and effort

Build before the event (small, documentation-only)
1. Dressing fields on the wound record: dressing type (free pick list: hydrogel, foam, alginate, film, other, none), last changed time, next change due. The FRD already has `Changed {lastTime} · due {nextTime}` on G7, so this is mostly making those fields editable by the nurse and labeled "entered by nurse". Cost: small. Claim: it saves re-typing, nothing about healing.
2. "Draft for clinician review" framing on every wound note and any text the AI produces, and a visible "Documentation aid, not a diagnosis" line. Cost: copy only. This is the cheapest risk reducer (see section 6).

Worth a mention as roadmap only
3. Dressing-change due timer in the Meds/Tasks list (a reminder that a change is due, using the nurse-entered interval). Reasonable and low risk, but it adds a new task type and test surface late in a freeze; ship only if 1 and 2 are done and tests are green.

Not worth building now
4. Color reference card and calibration step. The evidence says cards help but accuracy depends on lighting, lens and phone processing, and I found no head-to-head numeric study (dE) across phones. A 2017 SPIE study tested a 24-patch card with affine RGB correction; a 2023 Healthcare paper describes a custom chart; a Wounds review says accuracy is rarely measured; patents note cards disagree with published values (sources: https://www.spiedigitallibrary.org/conference-proceedings-of-spie/10136/1013617/Colorimetric-calibration-of-wound-photography-with-off-the-shelf-devices/10.1117/12.2254721.full, https://pmc.ncbi.nlm.nih.gov/articles/PMC9858639/, https://www.hmpgloballearningnetwork.com/site/wounds/literature-review/importance-accurate-color-wound-photography-and-data). [S] A calibration step on 512 px JPEG from glasses cameras would be unproven and invites the question "is it accurate?". A printed ruler or reference sticker in frame for size and plausibility is defensible; "calibrated color" is not.
5. Any pH or infection color reading from dressings. Not cleared, not validated, and it would turn the app into an analysis device.

## 6. Regulatory and safety cautions

- FDA's CDS guidance (issued Jan 6, 2026, superseded and reissued Jan 29, 2026) keeps software that acquires, processes or analyzes a medical image outside the non-device CDS exemption (Criterion 1). It says "images acquired for a medical purpose (e.g., pathology, dermatology)" count as medical images, and images not originally acquired for a medical purpose but analyzed for one also count. Source read in full: https://www.fda.gov/media/109618/download (text extracted 2026-11-21). [P]
- Implication for us: a wound photo is a medical image. Our Gemini step that returns a `finding` and `comparison` from the photo is image analysis. Our non-diagnostic framing (documentation aid, draft, nurse and doctor decide) helps, but the guidance text says image-input software remains a device, so we should not tell reviewers we are "exempt". Say instead: this is a hackathon prototype with synthetic data, it is not a medical device, and a real deployment would need a regulatory assessment (FDA device classification and clearance route) before any AI finding about a photo ships. I have not assessed enforcement discretion or other pathways; get regulatory advice. [U for conclusions beyond the quoted text]
- Interpretation caveat: the summaries from law firms say the 2026 update is silent on AI specifically. [S]
- Repo consistency: the FRD already labels AI output "AI result" or "Photo only", with fallback text "No AI review - see phone". Keep that. Never display a severity, infection or healing-trend verdict as fact.
- Privacy: real wound photos are PHI. The demo uses synthetic data only; the Gemini call must not receive real patient photos without an appropriate agreement. [U]

## 7. What we will NOT claim

- That we diagnose, detect infection, stage or grade a wound, or predict healing.
- That Bedside Glance improves healing, reduces infections or reduces errors (no study of our product exists).
- That hydrogels or any dressing are better because of our app.
- That we read pH, temperature, moisture or color from dressings.
- That photo color is calibrated or accurate.
- That we are FDA cleared, exempt, or "non-device CDS". We are an unregulated prototype on synthetic data.
- That the M6 glasses sense anything about the patient or nurse.
- Any dressing change interval as a clinical standard; intervals are nurse-entered and per facility protocol.
- Time savings figures from the pitch other than as labeled assumptions.

## 8. What to say to reviewers (paragraph)

"For wounds, Bedside Glance is a documentation and handoff aid. The nurse takes the photo on the glasses, enters or confirms the dressing type and when the next change is due, and the note goes to the phone as a draft for clinician review with the nurse and doctor staying in charge. We do not diagnose or score wounds. Any AI text is labeled as an AI result and can be ignored. Smart dressings with color or pH sensors exist in research, but we found none cleared by FDA, so we do not read them. All data in the demo is synthetic, and this is a prototype, not a medical device."

## 9. Three hard questions

1. "Isn't your wound AI a medical device?" Truthful answer: Probably yes in a real deployment. FDA's January 2026 CDS guidance treats software that analyzes a medical image as a device, and a wound photo is a medical image. For the hackathon it runs on synthetic data and is not a medical device; a real product needs a regulatory assessment first. Our design keeps the nurse's documentation useful even with the AI text turned off.
2. "Does this improve wound outcomes?" No evidence for that. We reduce re-typing and make handoff clearer; we have not measured outcomes and would not claim them. Even hydrogels themselves have weak Cochrane evidence for healing.
3. "Why not read the dressing color or use a calibration card?" The research is promising but early. Smart dressings were not found cleared by FDA, and photo color accuracy varies by phone, lens and lighting, with no head-to-head numeric validation that I found. We would rather ship fields nurses already chart than an unvalidated reading.

## 10. Recommendation

Build before the event: (1) dressing type, last changed and next due fields, nurse-entered and shown on the G7/G8/phone wound card; (2) "Draft for clinician review" and "documentation aid, not a diagnosis" labels on all wound text. Skip: color calibration, pH or infection readout, and anything hydrogel-specific beyond a pick list. A due timer in Tasks is optional after those two and only if tests stay green.

## 11. Sources (read 2026-11-21)

| Source | URL | Tag |
|---|---|---|
| FDA, Clinical Decision Support Software guidance, issued 2026-01-29 | https://www.fda.gov/media/109618/download | P |
| NPIAP PUSH Tool 3.0 | https://www.sralab.org/sites/default/files/2017-06/push3.pdf | P |
| NPIAP PUSH store page | https://learn.npiap.com/products/push-tool-3 | S |
| DermNet, dressings (professional) | https://pro.dermnetnz.org/procedures/dressings.html | S |
| WikEM, wound care dressing basics | https://wikem.org/wiki/Wound_care_dressing_basics | S |
| Wounds UK, hydrogel article | https://wounds-uk.com/wp-content/uploads/2023/02/content_10820.pdf | S |
| Cochrane, hydrogel dressings for venous leg ulcers (CD010738) | https://cochranelibrary.com/cdsr/doi/10.1002/14651858.CD010738.pub2/information | S |
| Dowsett et al. 2019, TIME CDST (J Wound Care) | https://www.elft.nhs.uk/research/resource/time-cdst-updated-tool-address-current-challenges-wound-care-dowsett-2019 | S |
| Wounds International 2025, TIMERS | https://woundsinternational.com/wp-content/uploads/2025/12/WINT-16-4_Pascal-_WEB-v2.pdf | S |
| In vivo smart sensor dressing, PubMed 40383028 | https://pubmed.ncbi.nlm.nih.gov/40383028/ | S |
| Purdue roll-to-roll sensor preprint 2025 | https://engineering.purdue.edu/StickTronics/wp-content/uploads/2025/08/2025-AHM-R2R.pdf | V |
| bioRxiv pH bandage smartphone detection | https://www.biorxiv.org/content/10.1101/2024.10.11.617850.full.pdf | V |
| News-Medical, smart wound patch 2025-08-06 | https://www.news-medical.net/news/20250806/Smart-wound-patch-detects-healing-progress-and-infection-risk.aspx | V |
| SPIE 2017 wound photo colorimetric calibration | https://www.spiedigitallibrary.org/conference-proceedings-of-spie/10136/1013617/Colorimetric-calibration-of-wound-photography-with-off-the-shelf-devices/10.1117/12.2254721.full | S |
| Healthcare 2023 calibration chart (PMC9858639) | https://pmc.ncbi.nlm.nih.gov/articles/PMC9858639/ | S |
| Wounds review, accurate color in wound photography | https://www.hmpgloballearningnetwork.com/site/wounds/literature-review/importance-accurate-color-wound-photography-and-data | S |
| FDA 510(k) classification pages (MGQ, FRO, NAE) | https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpcd/classification.cfm?id=MGQ | S |
| Glasses nose-pad tear sensing (PMC8372769) | https://pmc.ncbi.nlm.nih.gov/articles/PMC8372769 | S |

Open gaps: no Braden source fetched; no hydrogel change-interval guideline found; no direct FDA product-code search for sensing dressings; no numeric dE study across phones.
