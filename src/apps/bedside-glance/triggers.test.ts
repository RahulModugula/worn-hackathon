import { describe, expect, it } from 'vitest';
import { FINAL_ONLY_INTENTS, parseIntent } from './triggers';

describe('word-count lookaheads are linear time (no catastrophic backtracking)', () => {
  const hostile = [`${'a'.repeat(12)} `.repeat(7) + 'handoff', `${'a'.repeat(80)} `.repeat(3) + 'b c d e f g h done', 'a'.repeat(80) + ' b c d e f g h', `${'q'.repeat(30)} `.repeat(8) + 'undo','a'.repeat(80), `${'a'.repeat(80)} handoff`, `handoff ${'z'.repeat(80)}`, 'x'.repeat(80) + '!', `${'a'.repeat(40)} ${'b'.repeat(40)}`, 'ab '.repeat(27), `${'a'.repeat(200)} done`, `${'a'.repeat(200)} undo`];
  it('an 80-char token transcript is classified in under 5 ms for every short-utterance intent', () => {
    for (const t of hostile) {
      const t0 = performance.now();
      parseIntent(t, true);
      expect(performance.now() - t0, t.slice(0, 20)).toBeLessThan(5);
    }
  });
  it('handoff still needs at most six words', () => {
    expect(parseIntent('hand off to marcus now please')).toBe('handoff');
    expect(parseIntent('hand off to marcus now please thanks')).not.toBe('handoff');
    expect(parseIntent('start the handoff for this patient')).toBe('handoff');
    expect(parseIntent('start the handoff for this patient right now')).not.toBe('handoff');
    expect(parseIntent('we are done with the dressing now')).not.toBe('done');
  });
});

describe('voice false positives (adversarial review)', () => {
  it('done and undo only fire for short utterances', () => {
    expect(parseIntent('done')).toBe('done');
    expect(parseIntent('all done')).toBe('done');
    expect(parseIntent('undo')).toBe('undo');
    expect(parseIntent('undo that')).toBe('undo');
    expect(parseIntent('we are done with the dressing now')).not.toBe('done');
    expect(parseIntent('undo the last medication I gave')).not.toBe('undo');
  });
  it('done and undo never fire with a negation', () => {
    for (const t of ['not done', 'not done yet', "I'm not done", 'never done', 'done yet', "don't undo", "can't undo", 'don’t undo', 'not undo']) {
      expect(parseIntent(t), t).not.toBe('done');
      expect(parseIntent(t), t).not.toBe('undo');
    }
  });
  it('done and undo are final-only; interim may still drive close and context triggers', () => {
    expect(FINAL_ONLY_INTENTS).toEqual(expect.arrayContaining(['done', 'undo']));
    expect(parseIntent('done', false)).toBeNull();
    expect(parseIntent('undo', false)).toBeNull();
    expect(parseIntent('close', false)).toBe('close');
    expect(parseIntent('the wound looks red', false)).toBe('wound');
    expect(parseIntent('done', true)).toBe('done');
  });
  it('negated pain and wound do not trigger', () => {
    expect(parseIntent('no pain today')).toBeNull();
    expect(parseIntent('she denies pain')).toBeNull();
    expect(parseIntent("it doesn't hurt")).toBeNull();
    expect(parseIntent('without pain')).toBeNull();
    expect(parseIntent('no wound')).toBeNull();
    expect(parseIntent('pain is about a 7')).toBe('pain');
    expect(parseIntent('it hurts')).toBe('pain');
    expect(parseIntent('check the wound')).toBe('wound');
  });
  it('"go back to the wound" is not close; a bare "go back" or "close" is', () => {
    expect(parseIntent('go back to the wound')).not.toBe('close');
    expect(parseIntent('go back')).toBe('close');
    expect(parseIntent('close')).toBe('close');
    expect(parseIntent('dismiss that')).toBe('close');
    expect(parseIntent('close the door when you leave')).not.toBe('close');
  });
  it('capture needs a command, not a mention', () => {
    expect(parseIntent('a photo of my kids')).not.toBe('capture');
    expect(parseIntent('she showed me a picture of her dog')).not.toBe('capture');
    expect(parseIntent('take a photo')).toBe('capture');
    expect(parseIntent('capture')).toBe('capture');
    expect(parseIntent('photo')).toBe('capture');
    expect(parseIntent('take a picture of the dressing')).toBe('capture');
  });
});
