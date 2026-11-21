// Voice vocabulary for Bedside Glance. Pure data and matching; no React, no I/O.

export type Intent =
  | 'done'
  | 'next'
  | 'undo'
  | 'vitals'
  | 'close'
  | 'acknowledge'
  | 'retry'
  | 'send'
  | 'capture'
  | 'pain'
  | 'wound'
  | 'allergy'
  | 'room12'
  | 'room14';

/** Per-patient per-trigger cooldown for the pain and wound triggers (FRD section 3). */
export const COOLDOWN_MS = 60_000;

/** Negation words. A sentence with one of these never fires done/undo, and never triggers pain or wound. */
const NEGATION = String.raw`(?:n['’]t\b|\b(?:not|never|yet|no|nope)\b)`;
/** A question ("are you done", "when will it be done") is never a command. */
const QUESTION = String.raw`(?!\W*(?:are|is|was|were|did|do|does|have|has|will|would|when|what|who|how|why|can|could|should)\b)`;
/** At most three words in the whole utterance. */
const SHORT = String.raw`(?=(?:\S+\s*){1,3}$)`;
/** At most four words ("undo the last one"). */
const SHORT4 = String.raw`(?=(?:\S+\s*){1,4}$)`;
/** Pain/wound words preceded shortly by a negation ("no pain today", "denies pain", "doesn't hurt"). */
const NEGATED_CONTEXT = String.raw`(?!.*(?:\b(?:no|not|without|denies|denied|never)\b|n['’]t\b).{0,15}\b(?:pain|hurts?|hurting|wound|incision|dressing)\b)`;
const guarded = (re: RegExp): RegExp => new RegExp(`^${NEGATED_CONTEXT}.*?(?:${re.source})`);

export const PAIN_PATTERNS: RegExp[] = [
  /\bpain\b(?![- ]free)/,
  /\bhurts?\b/,
  /\bhurting\b/,
  /\b(?:like|about|around)\s+an?\s+(?:10|[0-9])\b/, // "like a 7"
  /\b(?:10|[0-9])\s*(?:out of|\/)\s*10\b/,
].map(guarded);

export const WOUND_PATTERNS: RegExp[] = [
  /\bwound\b/,
  /\bincision\b/,
  /\bdressing\b/,
  /\bsurgical site\b/,
].map(guarded);

/** Commands that move the workflow. Only acted on from a FINAL transcript: an interim "done" may still be "done... not". */
export const FINAL_ONLY_INTENTS: readonly Intent[] = ['done', 'undo'];

/** Order matters: the first matching spec wins. Commands come before the context triggers. */
export const INTENT_PATTERNS: ReadonlyArray<{ intent: Intent; patterns: RegExp[] }> = [
  { intent: 'acknowledge', patterns: [/\backnowledged?\b/] },
  { intent: 'retry', patterns: [/\bretry\b/, /\btry again\b/] },
  { intent: 'undo', patterns: [new RegExp(`^${SHORT4}${QUESTION}(?!.*${NEGATION}).*\\bundo\\b`)] },
  { intent: 'send', patterns: [/\bsend\b.*\b(?:phone|doctor|dr|patel|nguyen)\b/, /\bsend it\b/] },
  {
    intent: 'capture',
    patterns: [
      /^\W*(?:please\s+)?(?:take|capture|snap)\s+(?:an?\s+|the\s+)?(?:photo|picture|pic)(?:\s+of\s+the\s+(?:dressing|wound|incision|site))?\W*(?:please|now)?\W*$/,
      /^\W*(?:capture|photo|picture)\W*$/,
    ],
  },
  { intent: 'vitals', patterns: [/\bvitals?\b/] },
  { intent: 'next', patterns: [/\bnext\b/] },
  { intent: 'close', patterns: [/^\W*(?:please\s+)?(?:close|dismiss|go back)(?:\s+(?:that|this|it|please))?\W*$/] },
  { intent: 'room12', patterns: [/\broom\s*(?:number\s*)?(?:12|twelve)\b/] },
  { intent: 'room14', patterns: [/\broom\s*(?:number\s*)?(?:14|fourteen)\b/] },
  { intent: 'done', patterns: [new RegExp(`^${SHORT}${QUESTION}(?!.*${NEGATION}).*\\bdone\\b`)] },
  { intent: 'wound', patterns: WOUND_PATTERNS },
  { intent: 'pain', patterns: PAIN_PATTERNS },
];

/**
 * First matching intent for a transcript, or null. Case and surrounding space are ignored.
 * Pass `final: false` for an interim transcript: done and undo then never match.
 */
export function parseIntent(text: string, final = true): Intent | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const spec of INTENT_PATTERNS) {
    if (!final && FINAL_ONLY_INTENTS.includes(spec.intent)) continue;
    if (spec.patterns.some((p) => p.test(t))) return spec.intent;
  }
  return null;
}
