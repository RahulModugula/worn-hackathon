import { describe, it, expect } from 'vitest';
import { parseIntent, type Intent } from './triggers';

type Case = [string, Intent | null];

/** True commands: clear utterances a nurse would say. */
const POSITIVE: Case[] = [
  ...['done', 'Done', 'DONE', 'done.', 'done!', ' done ', "I'm done", 'im done', 'mark it done', 'mark done', 'all done', 'it is done', 'that is done', 'done please', 'okay done', 'med done', 'given done', 'done now', 'done, thanks'].map((p): Case => [p, 'done']),
  ...['next', 'Next', 'next one', 'next med', 'next please', 'go next', 'the next one', 'show next', 'next.', 'okay next'].map((p): Case => [p, 'next']),
  ...['undo', 'undo that', 'Undo', 'undo it', 'please undo', 'undo last', 'undo the last one', 'UNDO!', 'undo please'].map((p): Case => [p, 'undo']),
  ...['vitals', 'Vitals', 'show vitals', 'vital', 'vitals please', 'check vitals', 'open vitals', 'the vitals', 'vitals.', 'pull up vitals'].map((p): Case => [p, 'vitals']),
  ...['close', 'Close', 'close it', 'close that', 'close this', 'dismiss', 'dismiss that', 'go back', 'please close', 'close please', 'close.', 'dismiss it'].map((p): Case => [p, 'close']),
  ...['acknowledge', 'acknowledged', 'Acknowledge', 'I acknowledge', 'acknowledge it', 'acknowledge the alert', 'acknowledged.', 'okay acknowledge', 'ACKNOWLEDGE', 'I acknowledge that'].map((p): Case => [p, 'acknowledge']),
  ...['retry', 'Retry', 'retry it', 'try again', 'please retry', 'retry upload', 'retry the photo', 'okay retry', 'retry.', 'Try again'].map((p): Case => [p, 'retry']),
  ...['send to phone', 'send it', 'send to doctor', 'send to dr patel', 'send to Dr. Okafor', 'send it to the doctor', 'send to patel', 'send to nguyen', 'Send to phone', 'send it now', 'send this to the phone', 'send to the doctor'].map((p): Case => [p, 'send']),
  ...['room 12', 'Room 12', 'room twelve', 'room number 12', 'go to room 12', 'open room 12', 'room12', 'room number twelve', 'room 12 please', 'switch to room 12'].map((p): Case => [p, 'room12']),
  ...['room 14', 'Room 14', 'room fourteen', 'room number 14', 'go to room 14', 'open room 14', 'room14', 'room number fourteen', 'room 14 please', 'switch to room 14'].map((p): Case => [p, 'room14']),
  ...['take a photo', 'take photo', 'take a picture', 'take the picture', 'capture photo', 'snap a photo', 'snap a pic', 'capture the photo', 'photo', 'capture', 'picture', 'Take a photo', 'take a pic', 'take the photo', 'capture a picture'].map((p): Case => [p, 'capture']),
  ...['my leg hurts', 'it hurts', 'pain', 'pain in my leg', 'I have pain', 'he is in pain', 'it hurts a lot', 'my back hurts', 'hurting', 'it is hurting', 'pain is like a 7', 'pain 7 out of 10', 'I feel pain', 'severe pain', 'my knee hurts', 'pain at 8/10', 'about a 6', 'around a 5', 'sharp pain', 'chest pain'].map((p): Case => [p, 'pain']),
  ...['the dressing is itchy', 'check the wound', 'wound', 'the wound looks red', 'incision looks red', 'surgical site is red', 'dressing is soaked', 'dressing came off', 'look at the wound', 'wound check', 'the incision is open', 'the dressing is loose', 'my incision hurts?'].map((p): Case => [p, 'wound']),
];

/** Hard negatives: must NOT fire the dangerous intents (done/undo/acknowledge). */
const NEG_STRICT: string[] = [
  'not done yet', 'are you done', "I'm not done with lunch", "I'm not done", 'not done', 'never done', "isn't done", "wasn't done", "haven't done it", 'done yet?', 'yet to be done',
  'undone', 'doneness', 'abandoned', 'redone', 'overdone', 'condone', 'condoned', 'anyone', 'nextdoor', 'unclosed',
  'do not undo', "don't undo that", 'never undo', "can't undo", 'no undo', 'unacknowledged', 'acknowledgement', 'acknowledgments', 'I am not acknowledging',
  'the patient said they are done with dinner and want to talk about the discharge paperwork tomorrow',
  'when will the procedure be done', 'once the rounds are done we will talk', 'I have done this a hundred times before today',
  'what is undone here', 'undoing', 'undoable', 'reundo', 'abandon', 'donewell', 'rondone', 'overdone steak',
  'no pain today', 'a photo of my kids', 'photo of my kids', 'take a photo of my kids', 'my phone is dead', 'send me a text', 'sendit',
  'he denies pain', "it doesn't hurt", 'no wound here', 'without pain', 'not hurting', 'pain free',
  '', ' ', '   \n\t', '12', '14', '1412', '0', '-1', '3.14159', '1e308', 'NaN', 'null', 'undefined', 'true', '[]', '{}',
  'hola', 'listo', 'terminado', 'siguiente', 'deshacer', 'cerrar', 'me duele la pierna', 'habitación doce', 'enviar al doctor', 'tomar una foto', 'ya estoy listo', 'no he terminado', 'gracias', 'buenos dias',
  'good afternoon how are you feeling', 'did you eat lunch', 'the weather is nice', 'visiting hours end at eight', 'where is the bathroom', 'can I get some water', 'the TV is too loud', 'what time is it', 'my daughter is coming at three', 'blood pressure is fine',
  'is it done', 'when will it be done', 'did you undo it', 'who is done', 'can you undo', 'no no no', 'nope', 'not now', 'not yet', 'yet', 'stop', 'cancel that', 'hello', 'testing one two three', 'Maria is in bed twelve', 'bed twelve', 'room', 'room 13', 'room 120', 'room 1', 'rooms', 'bedroom', 'ballroom',
  '😀', '👍🏽', '完成', 'готово', 'منتهي', 'ｄｏｎｅ', 'dоne', 'd0ne', 'd one', 'do ne', 'u n d o', 'dónde', 'ñandú',
  "'; DROP TABLE patients; --", '<script>alert(1)</script>', '${process.exit(1)}', '{{7*7}}', '../../etc/passwd', 'SELECT * FROM meds WHERE done = 1', 'javascript:alert(1)', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
  'do\u0000ne', 'd\u200bone', 'u\u200bndo',
];
/** Negatives that may fire a harmless context intent but never done/undo/acknowledge. */
const DANGEROUS: Intent[] = ['done', 'undo', 'acknowledge'];

describe('voice intent corpus', () => {
  it('has at least 300 phrases', () => {
    expect(POSITIVE.length + NEG_STRICT.length).toBeGreaterThanOrEqual(300);
  });

  it('recall on clear true commands is >= 95% (and per-intent no intent below 90%)', () => {
    const per = new Map<string, { tp: number; n: number }>();
    const misses: string[] = [];
    for (const [text, want] of POSITIVE) {
      const got = parseIntent(text, true);
      const r = per.get(want!) ?? { tp: 0, n: 0 };
      r.n++;
      if (got === want) r.tp++; else misses.push(`${JSON.stringify(text)} -> ${got} (want ${want})`);
      per.set(want!, r);
    }
    const tp = [...per.values()].reduce((a, r) => a + r.tp, 0);
    const recall = tp / POSITIVE.length;
    // eslint-disable-next-line no-console
    console.log(`recall ${(recall * 100).toFixed(1)}% (${tp}/${POSITIVE.length}); misses: ${misses.join(' | ') || 'none'}`);
    expect(recall, misses.join('\n')).toBeGreaterThanOrEqual(0.95);
    for (const [intent, r] of per) expect(r.tp / r.n, `${intent}: ${misses.join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('zero false positives for done / undo / acknowledge on the negatives', () => {
    const fp: string[] = [];
    for (const text of NEG_STRICT) {
      const got = parseIntent(text, true);
      if (got && DANGEROUS.includes(got)) fp.push(`${JSON.stringify(text)} -> ${got}`);
    }
    expect(fp).toEqual([]);
  });

  it('precision: every fired intent on the combined corpus is the expected one', () => {
    let fired = 0, right = 0;
    const wrong: string[] = [];
    for (const [text, want] of POSITIVE) { const g = parseIntent(text, true); if (g) { fired++; if (g === want) right++; else wrong.push(`${text} -> ${g}`); } }
    for (const text of NEG_STRICT) { const g = parseIntent(text, true); if (g) { fired++; wrong.push(`${JSON.stringify(text)} -> ${g}`); } }
    const precision = right / fired;
    // eslint-disable-next-line no-console
    console.log(`precision ${(precision * 100).toFixed(1)}% (${right}/${fired}); wrong: ${wrong.join(' | ') || 'none'}`);
    expect(precision, wrong.join('\n')).toBeGreaterThanOrEqual(0.97);
  });

  it('interim transcripts never fire done or undo', () => {
    for (const t of ['done', "I'm done", 'undo', 'undo that', 'mark it done']) expect(parseIntent(t, false)).not.toBe(t.includes('undo') ? 'undo' : 'done');
  });

  it('never throws on arbitrary strings, and is case/space insensitive', () => {
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz  01234' + '56789\'’-.,!?/\\\u0000​😀é完';
    for (let i = 0; i < 2000; i++) {
      const len = Math.floor(rnd() * 80);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => parseIntent(s, true)).not.toThrow();
    }
    expect(parseIntent('  DONE  ')).toBe(parseIntent('done'));
  });
});

describe('matcher cost is bounded (no catastrophic backtracking)', () => {
  const adversarial: Record<string, string> = {
    spaces: ' '.repeat(10_000) + 'x',
    'words a': 'a '.repeat(5_000),
    'words done-less': 'do '.repeat(3_333) + 'ne',
    'many nots': "n't ".repeat(2_500),
    'pain tail': 'no '.repeat(3_000) + 'pain',
    'wound tail': ('not ' + 'x '.repeat(3)).repeat(1_000) + 'wound',
    'long a': 'a'.repeat(10_000),
    'long done': 'done'.repeat(2_500),
    'long punctuation': '!'.repeat(10_000),
    'room digits': 'room ' + '1'.repeat(10_000),
    'send phone': 'send ' + 'x '.repeat(4_900) + 'ph',
    'like a': 'like a '.repeat(1_400),
    'unicode': '😀'.repeat(5_000),
    'newlines': 'done\n'.repeat(2_000),
    'apostrophes': "'".repeat(10_000),
  };
  for (const [name, text] of Object.entries(adversarial)) {
    it(`${name} (${text.length} chars) parses in < 50 ms`, () => {
      parseIntent(text, true); // warm
      const t0 = performance.now();
      parseIntent(text, true);
      parseIntent(text, false);
      const ms = (performance.now() - t0) / 2;
      expect(ms).toBeLessThan(50);
    });
  }
});
