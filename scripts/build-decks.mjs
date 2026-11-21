// Builds three single-file offline pitch decks + a comparison page into docs/decks/.
// Plain Node, no dependencies. Screenshots in docs/img/*.png are inlined as base64 at build time,
// so re-run `npm run decks` after the UI is redesigned and `npm run screenshots` has refreshed the PNGs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'docs', 'img');
const OUT = path.join(ROOT, 'docs', 'decks');
const missing = new Set();
const used = new Set();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline a docs/img PNG as a data URI. Missing files render a visible placeholder (and are reported). */
function fig(name, caption, cls = '') {
  const file = path.join(IMG, `${name}.png`);
  if (!existsSync(file)) {
    missing.add(name);
    return `<figure class="${cls}"><div class="ph">missing image: ${esc(name)}.png<br>run npm run screenshots, then npm run decks</div>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }
  used.add(name);
  const b64 = readFileSync(file).toString('base64');
  return `<figure class="${cls}"><img alt="${esc(caption || name)}" src="data:image/png;base64,${b64}">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
}

const CSS = `
:root{--bg:#0a0c0d;--bg2:#12161a;--line:#232a30;--fg:#eef2f1;--mut:#9aa7a3;--mint:#7be0b8;--warn:#e7c46a}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#000;color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden}
#stage{position:absolute;left:50%;top:50%;width:1280px;height:720px;transform-origin:center center}
.slide{position:absolute;inset:0;width:1280px;height:720px;background:var(--bg);padding:64px 80px 72px;display:none;flex-direction:column;overflow:hidden}
.slide.on{display:flex}
.slide::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--mint);opacity:.9}
.kicker{font-size:20px;letter-spacing:.16em;text-transform:uppercase;color:var(--mint);font-weight:600;margin-bottom:22px}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82em;color:var(--mint)}
h1{font-size:104px;line-height:1.02;font-weight:700;letter-spacing:-.025em}
h2{font-size:56px;line-height:1.08;font-weight:700;letter-spacing:-.02em;margin-bottom:28px}
p,li{font-size:28px;line-height:1.4;color:#d5dcda}
.lead{font-size:34px;line-height:1.35;color:var(--fg)}
.mut{color:var(--mut)}.mint{color:var(--mint)}
.body{flex:1;display:flex;gap:48px;min-height:0}
.col{flex:1;display:flex;flex-direction:column;justify-content:center;min-width:0}
.col.fixed{flex:0 0 auto}
ul{list-style:none}li{padding:9px 0 9px 26px;position:relative}
li::before{content:"";position:absolute;left:0;top:23px;width:10px;height:10px;background:var(--mint);border-radius:2px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:24px 28px}
.grid{display:grid;gap:20px}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:1fr 1fr 1fr}
.big{font-size:84px;font-weight:700;letter-spacing:-.02em;color:var(--mint);line-height:1}
.cap{font-size:20px;color:var(--mut);line-height:1.35}
.card p{font-size:24px}.card .cap{margin-top:8px}
.tag{display:inline-block;font-size:17px;letter-spacing:.08em;text-transform:uppercase;padding:4px 12px;border-radius:99px;border:1px solid var(--mint);color:var(--mint);font-weight:600;vertical-align:middle}
.tag.warn{border-color:var(--warn);color:var(--warn)}
figure{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;min-width:0}
figure img{max-width:100%;max-height:430px;border-radius:10px;border:1px solid var(--line);display:block;object-fit:contain}
figure.tall img{max-height:520px}
figure.short img{max-height:300px}
figcaption{font-size:18px;color:var(--mut);margin-top:10px;text-align:center}
.ph{width:100%;height:260px;border:2px dashed var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--mut);font-size:18px;line-height:1.5}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:11px 16px;font-size:23px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mint);font-size:18px;letter-spacing:.1em;text-transform:uppercase;font-weight:600}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.foot{position:absolute;left:80px;right:80px;bottom:22px;font-size:16px;color:#6f7b77;display:flex;justify-content:space-between}
.src{font-size:17px;color:#7d8985;margin-top:14px;line-height:1.4}
.fict{position:absolute;right:56px;top:48px;font-size:18px}
#bar{position:fixed;left:0;bottom:0;height:3px;background:var(--mint);width:0;z-index:5}
#ctr{position:fixed;right:14px;top:8px;font-size:13px;color:#59635f;z-index:5}
#notes{position:fixed;left:0;right:0;bottom:0;max-height:38vh;overflow:auto;background:#05080aee;border-top:2px solid var(--mint);padding:16px 28px 20px;font-size:17px;line-height:1.5;color:#dfe7e4;display:none;z-index:9}
#notes.show{display:block}#notes b{color:var(--mint)}
.notes-print{display:none}
@media print{
 @page{size:1280px 720px;margin:0}
 html,body{height:auto;overflow:visible;background:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 #stage{position:static;transform:none!important;width:1280px;height:auto}
 .slide{display:flex!important;position:relative;break-after:page;page-break-after:always}
 #bar,#ctr,#notes{display:none!important}
}`;

const JS = `
(function(){
 var slides=[].slice.call(document.querySelectorAll('.slide')),i=0,st=document.getElementById('stage'),nt=document.getElementById('notes');
 function fit(){var s=Math.min(innerWidth/1280,innerHeight/720);st.style.transform='translate(-50%,-50%) scale('+s+')'}
 function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach(function(s,k){s.classList.toggle('on',k===i)});
  document.getElementById('bar').style.width=((i+1)/slides.length*100)+'%';document.getElementById('ctr').textContent=(i+1)+' / '+slides.length+'  (N notes, F fullscreen)';
  nt.innerHTML=slides[i].getAttribute('data-notes');try{history.replaceState(null,'','#'+(i+1))}catch(e){}}
 addEventListener('keydown',function(e){var k=e.key;
  if(k==='ArrowRight'||k==='PageDown'||k===' '||k==='Enter')show(i+1);
  else if(k==='ArrowLeft'||k==='PageUp'||k==='Backspace')show(i-1);
  else if(k==='Home')show(0);else if(k==='End')show(slides.length-1);
  else if(k==='f'||k==='F'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}
  else if(k==='n'||k==='N')nt.classList.toggle('show');
  else return;e.preventDefault()});
 addEventListener('click',function(e){if(e.target.closest('#notes'))return;show(e.clientX>innerWidth/2?i+1:i-1)});
 addEventListener('resize',fit);fit();
 var h=parseInt(location.hash.slice(1),10);show(isNaN(h)?0:h-1);
})();`;

/** slide(): html body, notes (plain text paragraphs), cut = which time-boxed cuts keep this slide. */
const slide = (body, notes, cut = [], foot = '') => ({ body, notes, cut, foot });

function buildDeck({ title, short, slides }) {
  const n = slides.length;
  const secs = slides.map((s, k) => {
    const badge = s.cut.length ? `<b>Kept in:</b> ${s.cut.map((c) => (c === '3' ? '3-min cut' : '90-s cut')).join(', ')}.<br>` : '<b>Skipped in the short cuts.</b><br>';
    const notes = `<b>Slide ${k + 1} of ${n}. </b>${badge}${s.notes.map(esc).join('<br><br>')}`;
    return `<section class="slide" data-notes="${esc(notes)}">${s.body}<div class="foot"><span>Bedside Glance &middot; ${esc(short)}</span><span>${esc(s.foot || 'Synthetic demo data. Nothing has run on real glasses yet.')}</span></div></section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div id="stage">${secs}</div><div id="bar"></div><div id="ctr"></div><div id="notes"></div><script>${JS}</script></body></html>`;
}

const UNM = '<span class="tag warn">Unmeasured on glasses</span>';
const STATUS = 'Honest status: built and tested on a laptop and phone browsers; nothing has run on real M6 glasses yet.';

// ---------------------------------------------------------------- Deck A
const deckA = {
  title: "Bedside Glance: Priya's shift",
  short: "Priya's shift",
  slides: [
    slide(`<div class="col"><div class="kicker">Worn Hackathon &middot; Seamless Handoff</div><h1>Priya's shift</h1><p class="lead mut" style="margin-top:28px;max-width:900px">A hands-free medication check on the glasses. The chart, finished on the phone. The two never disagree.</p><p class="cap" style="margin-top:36px">Bedside Glance &middot; MicroLumin M6 glasses + phone</p></div>`,
      ['Say plainly what we do in the first ten seconds: "Bedside Glance puts the right patient, the right drug and the allergy warning in a nurse\'s line of sight, hands free, and charts it to the phone in one tap or word."', 'Then move straight to Priya. Do not read the slide.'], ['3', '90'], 'Team Bedside Glance'),
    slide(`<span class="tag fict">Fictional character</span><div class="col"><div class="kicker">Meet Priya</div><h2>Priya is not real.</h2><p class="lead">She is a fictional nurse in our synthetic demo. Not a composite, not a patient interview, not a real person. We have no nurse interviews, so we will not pretend to.</p><ul style="margin-top:24px"><li>Evening med pass. One hand on the cart, the other in a glove.</li><li>Her patient is asleep and the wristband is under a blanket.</li><li>Every tap on a screen is a hand she does not have.</li></ul></div>`,
      ['Say out loud, not just on the slide: "Priya is fictional. She is a character in our synthetic demo, not a composite and not a real nurse. We built this weekend and have no interviews."', 'Source rule from docs/STORY-RESEARCH.md: composite characters must be labelled, and we have no interviews, so she is explicitly fictional. This avoids the overclaiming trap in healthcare pitches.', 'Keep the scene concrete and short. One character, one clear problem.'], ['3', '90'], 'Priya is fictional. All data is synthetic.'),
    slide(`<div class="body"><div class="col"><div class="kicker">What gets in the way</div><h2>The pass is full of interruptions.</h2><p class="lead">In a study of 4,271 observed administrations, more than half were interrupted. Each interruption was linked to more errors.</p><p class="src">Westbrook et al., Archives of Internal Medicine, 2010 (observational, 2006-08 data; via AHRQ PSNet).</p></div><div class="col fixed" style="width:340px;justify-content:center"><div class="card"><div class="big">53.1%</div><p class="cap" style="font-size:22px">of observed medication administrations were interrupted</p></div></div></div>`,
      ['This is the ONE number in the deck. Research in docs/STORY-RESEARCH.md (Small, Loewenstein & Slovic 2007) found that statistics placed next to an identifiable case reduced giving, so: story first, one number, never stacked.', 'Say "published estimate" if a reviewer pushes. It is observational data from 2006-08 and Westbrook 2010. Do not claim our app reduces errors by any percentage.', 'Alternate "what is" with "what could be" (Duarte 2010): this slide is the "what is".'], ['3', '90'], 'Source: Westbrook et al., Arch Intern Med, 2010, via AHRQ PSNet.'),
    slide(`<div class="body"><div class="col"><div class="kicker">What could be</div><h2>The check moves into her line of sight.</h2><p class="lead">Scan the wristband. Patient, due drug and the allergy warning appear on the glasses. The centre of her view stays empty.</p><p class="cap" style="margin-top:18px">${UNM} We target 640x480 and have only seen it in a browser.</p></div><div class="col fixed" style="width:620px">${fig('hero-hud', 'The glasses HUD states, rendered from the real app')}</div></div>`,
      ['"What could be." Priya scans the wristband with the glasses camera and the card shows who, what, and the allergy list from the chart.', 'Be straight about status: we have not run on real glasses. The HUD you see is the production build in a browser at the real 640x480 size. If the glasses are not available, project /glasses?mirror=1.', 'If a reviewer asks about the center of the view: clear zone x120-520 / y90-290 is always empty by design.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Live demo</div><h2>Scan. Meds. "Done."</h2><ul><li>Wristband scan opens the patient.</li><li>Due medications and the allergy bar, nothing in the middle.</li><li>She says "done". The phone chart updates.</li></ul></div><div class="col fixed" style="width:430px">${fig('hud-g4-meds-card', 'Meds card on the glasses (synthetic patient)', 'short')}</div><div class="col fixed" style="width:240px">${fig('phone-p4-activity-feed', 'Phone activity feed', 'tall')}</div></div>`,
      ['This is where the live demo happens (about 1:45 in the 3-minute cut). Order: scan wristband, point at the meds card, say "done", point at the phone.', 'Hand the phone to a reviewer for the Done tap at the table (90-second version).', 'If anything breaks: use the Director drawer without apologising, then the recorded run on the second device. Never blame the network first (Meta Connect 2025 lesson, uploadvr 2025).'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Seamless Handoff</div><h2>Two devices, one truth.</h2><p class="lead">A colleague taps the same dose on a phone a second later. The server keeps the first write and shows who gave it. Either device can undo for 10 seconds.</p><p class="cap" style="margin-top:20px">No double dose. No arguing devices.</p></div><div class="col fixed" style="width:560px">${fig('hud-conflict-banner', 'Conflict banner: already given, via glasses')}</div></div>`,
      ['Trigger with Director > Conflict. The banner reads "Already given ... via glasses".', 'Say: first write wins, and undo works from either device for ten seconds.', 'This is the Seamless Handoff track in one picture: start on the glasses, finish on the phone, and they never disagree.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">When she needs a second opinion</div><h2>Photo on the glasses. Draft on the phone.</h2><p class="lead">Priya captures a wound. The phone shows before and after with a draft note for clinician review, and sends it to the attending.</p><p class="cap" style="margin-top:20px">A draft for review. It does not measure, stage or diagnose, and the nurse decides.</p></div><div class="col fixed" style="width:400px">${fig('phone-p3-wound-review', 'Wound review on the phone', 'tall')}</div></div>`,
      ['Keep it short: say "wound", capture, the phone shows the draft note, send to the doctor, and the reply lands on the glasses.', 'Positioning: documentation aid. We stay out of the diagnostic lane on purpose (image-analysis tools can be regulated as devices). Nurse decides.', 'Skipped in the 90-second table cut. Only show if time allows.'], ['3']),
    slide(`<div class="col"><div class="kicker">Back to Priya</div><h2 style="font-size:72px">Same cart. Same hands.<br>One fewer thing to remember.</h2><p class="lead mut" style="margin-top:20px;max-width:960px">At the end of her pass the chart is already right, and she looked at her patient, not a screen.</p><p class="cap" style="margin-top:24px">Nurses say they want to be present with patients, not at a screen (Corewell Health CNIO; vendor-reported, snippet).</p></div>`,
      ['Closing callback to the opening scene. Do not add a new statistic. Priya\'s hands are free; the chart is right.', 'The quote is from docs/STORY-RESEARCH.md (Corewell Health CNIO, secondary). It is a sentiment, not a measured result. Cut it if you are short on time.'], ['3'], 'Priya is fictional.'),
    slide(`<div class="body"><div class="col"><div class="kicker">The ask</div><h2>One med-surg unit. 90 days.</h2><ul><li>5 to 10 devices.</li><li>Measure scan compliance, documentation minutes and near-misses against a control unit.</li><li>A $300-600 display with a camera is the price where a hospital says yes.</li></ul></div><div class="col fixed" style="width:420px"><div class="card"><p class="mint" style="font-weight:600">Honest status</p><p style="margin-top:8px">Built and tested on laptop and phone browsers. Nothing has run on real M6 glasses yet. Synthetic data only.</p></div></div></div>`,
      ['Say the ask in one sentence, then stop: "We want one med-surg unit for a 90-day pilot, five to ten devices, and the pilot\'s job is to measure the minutes saved."', 'Break-even math, if asked: a ~$450 device breaks even at about 4.6 minutes saved per shift (about 2.3 captured) when only half is real capacity. Payback means device price only, one year, one device per nurse; it excludes servers, support, training and integration. 15 min/shift is our ASSUMPTION, not a measurement.', 'Q&A: see docs/PITCH.md objections table.'], ['3', '90']),
  ],
};

// ---------------------------------------------------------------- Deck B
const deckB = {
  title: 'Bedside Glance: Why hospitals buy M6',
  short: 'Why hospitals buy M6',
  slides: [
    slide(`<div class="col"><div class="kicker">Worn Hackathon &middot; Seamless Handoff</div><h1>Why hospitals<br>buy M6</h1><p class="lead mut" style="margin-top:28px;max-width:960px">Bedside Glance turns a $300-600 display with a camera into a medication-safety and charting tool a nurse manager can justify.</p></div>`,
      ['One sentence: "A hospital buys nurse time and safety. We show the price point and the math at which a pair of glasses pays for itself."', 'Be explicit that every number on the next slides is sourced or labelled an assumption.'], ['3', '90'], 'Team Bedside Glance'),
    slide(`<div class="kicker">The cost is already there</div><h2>Nurse time and safety are the budget.</h2><div class="grid g3" style="margin-top:6px"><div class="card"><div class="big" style="font-size:64px">66%</div><p>of administrations involved a workaround in barcode-scanning hospitals; 36% skipped scanning.</p><p class="cap">Multicenter study, pubmed 32043705</p></div><div class="card"><div class="big" style="font-size:64px">19.6%</div><p>median share of opportunities for error (8.0% excluding timing errors).</p><p class="cap">Keers et al., 2013, Ann Pharmacother, 91 observation studies</p></div><div class="card"><div class="big" style="font-size:64px">$60,090</div><p>to replace one bedside RN; 17.6% turnover, 8.6% vacancy.</p><p class="cap">NSI National Health Care Retention Report, 2026 (CY2025 data)</p></div></div><p class="src" style="margin-top:22px">Also: acute-care nurses averaged 4.7 h of EMR documentation per 12-h shift (study year not verified); flowsheets were 31% of a 12-h shift (JMIR Nursing, 2025). Published estimates, not our measurements.</p>`,
      ['Who pays: the health system\'s nursing and quality budget. Buyer: nurse managers and CNOs. First unit: med-surg.', 'Every figure here is in docs/PITCH.md "Sourced numbers". Say "published estimate" if pushed. Do not claim our app reduces errors by any percentage.', 'Do not stack more numbers than this. Three cards, then move on.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Why earlier headsets stalled</div><h2>Price, lock-in, no workflow.</h2><ul><li>Google Glass Enterprise ended in 2023.</li><li>HoloLens 2 was discontinued in 2024.</li><li>Most providers still use phones.</li></ul><p class="lead mint" style="margin-top:18px">A $2,500 headset needs about 25 minutes saved per shift. A $300-600 display needs far less.</p></div></div><p class="src">Sources: 9to5google, macrumors, hitconsultant (Augmedix CEO on phones); see docs/RESEARCH-MARKET.md notes. The 25-minute figure is our arithmetic from the break-even model on the next slide.</p>`,
      ['Why glasses and not a phone (expected question): the glasses win when both hands are busy, gloves are on, and the nurse is standing at the bed. The phone is the depth surface.', 'The pitch to MicroLumin: a waveguide display with a camera at roughly $300-600 is exactly the price point where a hospital says yes.', 'Do not claim hospital partners or logos.'], ['3']),
    slide(`<div class="body"><div class="col"><div class="kicker">The product, one glance</div><h2>Scan, check, chart, handoff.</h2><ul><li>Identity, due drug and allergy in the first second.</li><li>"Done" charts to the phone; first write wins.</li><li>Wound photo becomes a draft note for clinician review.</li></ul><p class="cap" style="margin-top:14px">${UNM}</p></div><div class="col fixed" style="width:600px">${fig('hero-hud', 'Glasses HUD states from the production build')}</div></div>`,
      ['Live demo happens here (about 1:45 in the 3-minute cut). Scan, meds card, done, phone updates, conflict banner, undo.', 'Hardware sponsor angle: this is what makes M6 a clinical tool instead of a gadget, and it only needs a display, a camera, and a phone.', 'Status: not yet run on real glasses. Say so.'], ['3', '90']),
    slide(`<div class="kicker">Per-device break-even</div><h2>Roughly 4.6 minutes per shift.</h2><table><tr><th>Input</th><th>Value</th><th>Basis</th></tr><tr><td>Loaded RN cost</td><td class="n">about $139K / yr</td><td>BLS median RN wage $97,550 (May 2025) x 1.43 (our assumed benefits multiplier)</td></tr><tr><td>One minute per shift</td><td class="n">about $194 / yr</td><td>per nurse, from the loaded cost</td></tr><tr><td>Device</td><td class="n">about $450</td><td>assumed price point</td></tr><tr><td>Break-even</td><td class="n mint">about 4.6 min / shift</td><td>about 2.3 min captured at 50%; device price only, excludes servers, support, training</td></tr><tr><td>At 15 min / shift</td><td class="n">about $1,450 / nurse / yr</td><td><span class="tag warn">Assumption</span> no study measures glasses savings yet</td></tr></table><p class="src">Our arithmetic from BLS inputs. The pilot's job is to measure real minutes. Peer benchmark only: ambient AI scribing saved nurses about 28 min per shift at about 60% use in a 90-day pilot (Corewell Health, vendor-reported).</p>`,
      ['Walk the table top to bottom. The honest framing: 15 minutes per shift is an ASSUMPTION. Break-even needs only about 4.6 minutes saved, because we assume only half of saved time becomes real capacity.', 'Check: $450 / $194 = about 2.3 captured minutes, which is about 4.6 saved minutes at 50% capture. At 15 min and 50%, 7.5 x $194 is about $1,450.', 'The /impact page in the app shows the same math. Never say "we saved X minutes": we have not measured.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Who buys</div><h2>A large, reachable buyer.</h2><div class="grid g3" style="margin-top:6px"><div class="card"><div class="big" style="font-size:56px">3.47M</div><p class="cap" style="font-size:20px">US RN jobs in 2025; about 59% in hospitals (BLS)</p></div><div class="card"><div class="big" style="font-size:56px">6,100</div><p class="cap" style="font-size:20px">US hospitals, 907,216 staffed beds (AHA 2024 survey)</p></div><div class="card"><div class="big" style="font-size:56px">1 unit</div><p class="cap" style="font-size:20px">med-surg is the wedge; one nurse manager signs</p></div></div><p class="src" style="margin-top:18px">Market-size reports disagree widely (medical smart glasses roughly $2.6B in 2026 to $7.6B in 2033, Persistence). Analyst estimates; we do not lean on them.</p></div></div>`,
      ['Buyer: nurse manager or CNO. Payer: the nursing and quality budget. Land with one unit, expand by unit.', 'Say "analyst estimates" for the market-size line, or skip it. Counts of RNs and hospitals are BLS and AHA.'], ['3']),
    slide(`<div class="kicker">The pilot</div><h2>One unit, 90 days, measured.</h2><div class="grid g3"><div class="card"><p class="mint" style="font-weight:600">Setup</p><p>5 to 10 devices on one med-surg unit, a clinical champion, a control unit.</p></div><div class="card"><p class="mint" style="font-weight:600">Measure</p><p>Scan compliance, documentation minutes per shift, near-misses.</p></div><div class="card"><p class="mint" style="font-weight:600">Decide</p><p>Does measured capture beat the 4.5-minute break-even? Expand, or stop.</p></div></div><p class="lead mut" style="margin-top:28px">Read-only chart launch first. Write-back only after security review.</p>`,
      ['The pilot exists to replace our assumption with a measurement. If minutes saved is below break-even, we say so.', 'Production path: 1) one-unit pilot, 2) metrics vs control, 3) read-only FHIR/Epic app launch, write-back after security review, 4) BAA, SOC 2 roadmap, MDM, 5) documented intended use and FDA determination before any analytics, 6) privacy and infection-prevention sign-off.'], ['3']),
    slide(`<div class="kicker">Honest positioning</div><h2>A documentation aid. Not a diagnostic.</h2><div class="grid g2"><div class="card"><p class="mint" style="font-weight:600">FDA</p><p>The nurse decides. The wound feature drafts a note for clinician review; it does not measure, stage or diagnose. An FDA determination comes before any analytics.</p></div><div class="card"><p class="mint" style="font-weight:600">HIPAA and privacy</p><p>Synthetic data only today. Production needs a BAA, encryption, MDM and unit sign-off. No audio stored; the server holds up to 20 photos in memory (not on disk). Audio goes to Deepgram and photos to Gemini only if keys are set; no BAA in the demo.</p></div></div><p class="src" style="margin-top:20px">The allergy alert shows the chart's own allergy list next to the scanned patient's meds. It does not override or block. We claim no clearance, no real patients and no hospital partners.</p>`,
      ['Answer FDA and HIPAA questions with this slide. We deliberately stay in the documentation lane.', 'Theranos-style overclaiming sinks healthcare pitches (docs/STORY-RESEARCH.md). Do not use logos implying endorsement.'], ['3']),
    slide(`<div class="body"><div class="col"><div class="kicker">The ask</div><h2>Let us measure it on a real unit.</h2><ul><li>Hospitals: one med-surg unit, 5 to 10 devices, 90 days.</li><li>MicroLumin: a $300-600 display with a camera, and your help getting it on a nurse's face.</li><li>Reviewers: tell us where the math is wrong.</li></ul></div><div class="col fixed" style="width:420px"><div class="card"><p class="mint" style="font-weight:600">Honest status</p><p style="margin-top:8px">Nothing has run on real M6 glasses yet. 15 min/shift is an assumption. Demo data is synthetic.</p></div></div></div>`,
      ['One sentence ask, then stop. "We want one med-surg unit for a 90-day pilot, and the price point is what makes it a yes."', 'Q&A: PITCH.md objections table. Battery, heat and weight: not benchmarked, say so.'], ['3', '90']),
  ],
};

// ---------------------------------------------------------------- Deck C
const deckC = {
  title: 'Bedside Glance: Engineering trust',
  short: 'Engineering trust',
  slides: [
    slide(`<div class="col"><div class="kicker">Worn Hackathon &middot; Seamless Handoff</div><h1>Engineering<br>trust</h1><p class="lead mut" style="margin-top:28px;max-width:960px">Two devices, one source of truth, and a display that obeys its own law. What we measured, what we did not.</p></div>`,
      ['Frame: a handoff is only seamless if the two devices can never disagree. This deck is how we make that true and how you can check it.', 'Open with the honest status: nothing has run on real glasses yet.'], ['3', '90'], 'Team Bedside Glance'),
    slide(`<div class="kicker">Architecture</div><h2>One server decides. Everyone else renders.</h2><div class="grid g3"><div class="card"><p class="mint" style="font-weight:600">One app</p><p>Vite + React + TypeScript SPA. Glasses, phone and impact pages are routes.</p></div><div class="card"><p class="mint" style="font-weight:600">One server</p><p>Node / Express / ws. Authoritative state, one port in production.</p></div><div class="card"><p class="mint" style="font-weight:600">Shared code</p><p>Types and the clock are imported by both sides. No Firebase, no buckets.</p></div></div><p class="lead mut" style="margin-top:26px">The HUD toolkit has zero product strings and zero imports from the apps. A test enforces it.</p>`,
      ['Keep it brief. The point: small surface, one authority. The module boundary (src/hud-kit has no Bedside-Glance strings and no imports from src/apps) is enforced by a test, so the toolkit is reusable for other Worn apps.', 'Stack choices were made to keep Windows and iPhone teammates productive.'], ['3']),
    slide(`<div class="kicker">Sync correctness</div><h2>Four rules, each with a failing test.</h2><div class="grid g2"><div class="card"><p class="mint" style="font-weight:600">First write wins</p><p>Exactly one <code>given</code> per medication. A second device is told who won.</p></div><div class="card"><p class="mint" style="font-weight:600">10 s cross-device undo</p><p>Either device can undo, only inside 10,000 ms.</p></div><div class="card"><p class="mint" style="font-weight:600">Idempotent events</p><p>A replayed <code>clientEventId</code> never changes state.</p></div><div class="card"><p class="mint" style="font-weight:600">Offline outbox</p><p>Actions queue in localStorage and flush once on reconnect.</p></div></div><p class="src">Applying an action is synchronous on the server (no awaits inside), so two actions can never interleave.</p>`,
      ['Walk the four rules. The server applyAction is synchronous so there is no race inside a session.', 'Proof is on the next slide. Reproduce with: npm test.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Proof, not assertion</div><h2>We tried to break it.</h2><ul><li>20,000 seeded action sequences, invariants checked after every step.</li><li>Mutation checks: undo window +1 ms, first-write-wins off, reset leaving state behind. Each failed within a few sequences.</li><li>200 sockets racing one dose: exactly one winner.</li></ul><p class="cap" style="margin-top:10px">Replay any failure with <code>STRESS_SEED=n STRESS_RUNS=1</code>.</p></div><div class="col fixed" style="width:480px">${fig('hud-conflict-banner', 'What the loser of the race sees')}</div></div>`,
      ['Sources: server/stress.fuzz.test.ts and server/stress.abuse.test.ts, described in docs/COMPAT-PERF.md "Stress results" (2026-11-21).', 'Mutation checks show the tests can fail, which is the point of "prove a check can fail".', 'Live: trigger Director > Conflict while showing this slide, or just demo the glasses then the phone.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Display law</div><h2>640x480, black is see-through.</h2><ul><li>Clear zone x120-520 / y90-290 is always empty.</li><li>Bottom card y300-440, 528 px inner, text 18 px or larger.</li><li>Every line is nowrap with ellipsis; copy is verbatim from the spec.</li><li>Scanner reads only the centre 480x480 of 1280x720, 4 FPS.</li></ul><p class="cap" style="margin-top:8px">${UNM} Layout verified in a browser, not on the waveguide.</p></div><div class="col fixed" style="width:560px">${fig('hud-g4-meds-card', 'Meds card at 640x480')}</div></div>`,
      ['A waveguide display is not a monitor: black means transparent, so we never put anything where the wearer looks through. These rules are written down in the spec and checked in the browser end-to-end run.', 'Unmeasured: contrast and legibility outdoors or under ward lighting on the real optics.'], ['3']),
    slide(`<div class="body"><div class="col"><div class="kicker">Legacy WebView</div><h2>Built for Chromium 69.</h2><ul><li>Android 9 WebView, factory version unknown, so we build for 69 and guard it.</li><li><code>check-legacy</code> fails the build on syntax, CSS or APIs 69 lacks.</li><li>Hand-written polyfills, no core-js. Glasses route never loads phone code.</li></ul><p class="cap" style="margin-top:10px">${UNM} Never executed in a real Chromium 69 engine.</p></div><div class="col fixed" style="width:360px"><div class="card"><div class="big" style="font-size:60px">121,215 B</div><p class="cap">/glasses JS, gzip. Budget 140,000 B. Measured 2026-11-21, <code>npm run check-budgets</code>.</p></div></div></div>`,
      ['Everything on this slide is from docs/COMPAT-PERF.md. The 121,215 B figure is a measured bundle size, not a runtime measurement on the device.', 'Open item: confirm the WebView version with adb shell dumpsys webviewupdate on the real device.'], ['3']),
    slide(`<div class="kicker">Measured, with date and method</div><h2>Numbers we will stand behind.</h2><table><tr><th>Measure</th><th>Value</th><th>Method (2026-11-21, laptop, localhost)</th></tr><tr><td>Soak: actions acked</td><td class="n">10,000 of 10,000</td><td>50 sessions x 20 flows with chaos: socket kills, offline toggles, garbage frames, duplicate events</td></tr><tr><td>Ack latency p50 / p95</td><td class="n">0.43 / 7.39 ms</td><td>same run, n=8,893 (chaos-overlapped actions excluded)</td></tr><tr><td>Convergence</td><td class="n">all clients = server</td><td>final state deep-equalled the server snapshot; check fails if broadcasts are dropped</td></tr><tr><td>QR decode p95</td><td class="n">0.46 ms</td><td>200 runs, Node, Apple Silicon. Desktop CPU: not a WebView number</td></tr></table><p class="src">All of this is from a laptop. Not measured: battery, heat, weight, ward-noise voice accuracy, any latency over real Bluetooth or the glasses. ${esc('')}</p>`,
      ['Read the footer first: every number is from a laptop on localhost. Latency over real glasses is unmeasured. Battery is unmeasured.', 'Decode headroom is about 326x at p95 on a desktop, but the old phone may be much slower; plan for 10x. Confirm on the device.', 'Do not quote the "less than 1 s" figure as measured on glasses. It is a target.'], ['3']),
    slide(`<div class="body"><div class="col"><div class="kicker">Voice and fallbacks</div><h2>Everything has a plan B.</h2><div class="grid g3" style="margin-top:4px"><div class="card"><p class="mint" style="font-weight:600">Tier 1</p><p>Cloud speech (Deepgram)</p></div><div class="card"><p class="mint" style="font-weight:600">Tier 2</p><p>Browser speech</p></div><div class="card"><p class="mint" style="font-weight:600">Tier 3</p><p>Tap or ring</p></div></div><ul style="margin-top:14px"><li>No key, camera, mic or network never crashes the demo.</li><li>Wound note falls back to a recorded response; the Director drawer drives the whole flow.</li><li>Phone Scan &amp; Talk works if the glasses are display-only.</li></ul></div><div class="col fixed" style="width:300px">${fig('phone-director-drawer', 'Director drawer + preflight', 'tall')}</div></div>`,
      ['Tap is the primary confirmation; voice is a convenience tier. Ward-noise mic accuracy is NOT measured.', 'Optional services: Gemini (wound note draft) and Deepgram (speech); both have local fallbacks. API keys are environment variables only.', 'Hardware caveat: kit docs do not document ring key codes or plain-app mic and camera on the glasses, so the phone-scans-and-listens mirror mode is a first-class fallback.'], ['3', '90']),
    slide(`<div class="body"><div class="col"><div class="kicker">Verify it yourself</div><h2>604 tests. One command.</h2><ul><li><code>npm run check</code>: typecheck, boundary lint, PII audit, docs check, build, legacy check, budgets, tests.</li><li><code>npm run e2e</code>: real browser against the production build.</li><li><code>npm run stress</code>: the soak and chaos harness.</li></ul><p class="cap" style="margin-top:10px">604 passing in <code>npm test</code> on 2026-11-21. Re-run before quoting.</p></div><div class="col fixed" style="width:420px"><div class="card"><p class="mint" style="font-weight:600">The ask</p><p style="margin-top:8px">A real pair of M6 glasses and 30 minutes: we run the WebView check, measure end-to-end latency and fill in every "unmeasured" tag.</p></div></div></div>`,
      ['Close with the ask: a short window on real hardware to replace every "unmeasured on glasses" with a number. And invite reviewers to run npm run check.', 'Tests count was read on 2026-11-21 from vitest (604 passed); re-run before you say a number on stage.'], ['3', '90']),
  ],
};

// ---------------------------------------------------------------- Index
const DECKS = [
  { file: 'deck-a-priya.html', d: deckA, name: "A. Priya's shift", fits: 'Story-minded and generalist reviewers, a mixed room, anyone who has to remember one thing tomorrow. Best on a cold stage audience.', risks: 'Fictional character must be labelled out loud or it reads as fake evidence. Only one number, so a business-minded reviewer may find the money thin (answer from PITCH.md). Demo carries the story: if the demo fails, the deck loses its payoff.', cut90: 'Slides 1, 2, 3, then demo at the table (scan, done, conflict), then slide 9 ask.' },
  { file: 'deck-b-business.html', d: deckB, name: 'B. Why hospitals buy M6', fits: 'Business, market and hardware-sponsor reviewers, anyone asking "who pays". Also the best deck to pitch MicroLumin on what M6 needs to cost.', risks: 'Break-even rests on an assumed 15 min/shift and an assumed device price; a sharp reviewer will push there. Market numbers are secondary. Number-heavy slides can drown the demo, and it has the least product-story warmth.', cut90: 'Slides 1, 2, 4 (demo), 5 (break-even), 9 (ask).' },
  { file: 'deck-c-engineering.html', d: deckC, name: 'C. Engineering trust', fits: 'Engineering and platform reviewers, SDK maintainers, anyone who will probe sync, offline and WebView questions.', risks: 'Most "unmeasured" tags, since nothing has run on glasses: it can undersell the product value. Dense; keep slides on screen for a few seconds only. Weakest on who-pays, so rehearse the PITCH.md answer.', cut90: 'Slides 1, 3, 4 (conflict proof, demo it), 8 (fallbacks), 9 (ask).' },
];

function cutList(d, key) {
  return d.slides.map((s, k) => (s.cut.includes(key) ? k + 1 : null)).filter(Boolean).join(', ');
}

function buildIndex() {
  const cards = DECKS.map(({ file, d, name, fits, risks, cut90 }) => `<article class="dk"><h2>${esc(name)}</h2><p class="meta">${d.slides.length} slides &middot; <a href="${file}">open deck</a></p><h3>Best fit</h3><p>${esc(fits)}</p><h3>3-minute cut</h3><p>Slides ${cutList(d, '3')} on screen, with the live demo between the product slide and the closing slides. Timing from docs/demo-script.md: problem 0:00-0:20, one sentence 0:20-0:40, demo 0:40-2:25, who pays 2:25-2:50, ask 2:50-3:00.</p><h3>90-second table cut</h3><p>${esc(cut90)} Flagged slides: ${cutList(d, '90')}. Hand the phone to the reviewer for the Done tap.</p><h3>Risks</h3><p>${esc(risks)}</p></article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bedside Glance decks</title><style>
:root{--bg:#0a0c0d;--bg2:#12161a;--line:#232a30;--fg:#eef2f1;--mut:#9aa7a3;--mint:#7be0b8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5;padding:48px 24px}
main{max-width:1200px;margin:0 auto}h1{font-size:44px;letter-spacing:-.02em;margin:0 0 8px}.lead{color:var(--mut);font-size:19px;max-width:820px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-top:32px}
.dk{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:26px}.dk h2{margin:0 0 4px;font-size:26px}
.dk h3{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--mint);margin:20px 0 4px}.dk p{margin:0;color:#d5dcda;font-size:16px}.meta{color:var(--mut)!important}
a{color:var(--mint)}.note{margin-top:32px;color:var(--mut);font-size:15px;border-top:1px solid var(--line);padding-top:18px}</style></head><body><main><h1>Bedside Glance: three decks</h1><p class="lead">Same product, same honest status, three angles. Pick by room. Each deck has speaker notes (N), fullscreen (F), arrow-key navigation and print-to-PDF at 16:9. Offline, single file.</p><div class="grid">${cards}</div><p class="note">Shared rules: only numbers from docs/PITCH.md and docs/COMPAT-PERF.md; assumptions are labelled; nothing has run on real glasses; data is synthetic. Print to PDF from Chrome with background graphics on. Regenerate with <code>npm run decks</code> after <code>npm run screenshots</code>. Images inlined this build: ${used.size}${missing.size ? `; missing: ${[...missing].map(esc).join(', ')}` : ''}.</p></main></body></html>`;
}

mkdirSync(OUT, { recursive: true });
const outputs = DECKS.map(({ file, d }) => [file, buildDeck(d)]);
outputs.push(['index.html', buildIndex()]);
for (const [f, html] of outputs) {
  writeFileSync(path.join(OUT, f), html);
  console.log(`  docs/decks/${f}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}
if (missing.size) console.warn(`WARNING: missing images (placeholders used): ${[...missing].join(', ')}`);
console.log(`Inlined ${used.size} distinct image(s).`);
