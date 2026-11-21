import { describe, expect, it, vi } from 'vitest';
import { createIntentMatcher, type IntentSpec } from './intentMatcher';

function setup(intents: IntentSpec[]) {
  let t = 0;
  const onMatch = vi.fn();
  const matcher = createIntentMatcher({ intents, onMatch, now: () => t });
  return {
    matcher,
    onMatch,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe('intentMatcher', () => {
  it('matches interim and final transcripts', () => {
    const { matcher, onMatch, at } = setup([{ intent: 'alpha', patterns: [/\balpha\b/] }]);
    expect(matcher.feed('alpha', false)?.final).toBe(false);
    at(2000);
    expect(matcher.feed('alpha', true)?.final).toBe(true);
    expect(onMatch).toHaveBeenCalledTimes(2);
  });

  it('normalises case and whitespace and ignores non-matching or empty text', () => {
    const { matcher, onMatch } = setup([{ intent: 'alpha', patterns: [/\balpha\b/] }]);
    expect(matcher.feed('  ALPHA ', true)?.text).toBe('alpha');
    expect(matcher.feed('beta', true)).toBeNull();
    expect(matcher.feed('   ', true)).toBeNull();
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('debounces an intent for 1.5 s across interim and final results', () => {
    const { matcher, onMatch, at } = setup([{ intent: 'beta', patterns: [/\bbeta\b/] }]);
    expect(matcher.feed('beta', false)).not.toBeNull();
    at(1499);
    expect(matcher.feed('beta', true)).toBeNull();
    at(1500);
    expect(matcher.feed('beta', true)).not.toBeNull();
    expect(onMatch).toHaveBeenCalledTimes(2);
  });

  it('debounce is per intent', () => {
    const { matcher, onMatch } = setup([
      { intent: 'alpha', patterns: [/\balpha\b/] },
      { intent: 'beta', patterns: [/\bbeta\b/] },
    ]);
    matcher.feed('alpha', true);
    matcher.feed('beta', true);
    expect(onMatch.mock.calls.map((c) => c[0].intent)).toEqual(['alpha', 'beta']);
  });

  it('cooldown is per key: a key waits out its cooldown while other keys fire', () => {
    const { matcher, onMatch, at } = setup([{ intent: 'gamma', patterns: [/\bgamma\b/], cooldownMs: 60_000 }]);
    expect(matcher.feed('gamma', true, 'k1')).not.toBeNull(); // t=0
    at(2000);
    expect(matcher.feed('gamma', true, 'k2')).not.toBeNull(); // other key, not blocked
    at(4000);
    expect(matcher.feed('gamma', true, 'k1')).toBeNull(); // k1 still cooling down
    at(59_999);
    expect(matcher.feed('gamma', true, 'k1')).toBeNull();
    at(60_000);
    expect(matcher.feed('gamma', true, 'k1')).not.toBeNull();
    expect(onMatch).toHaveBeenCalledTimes(3);
  });

  it('cooldown does not apply without a key, so only the debounce applies', () => {
    const { matcher, onMatch, at } = setup([{ intent: 'gamma', patterns: [/\bgamma\b/], cooldownMs: 60_000 }]);
    matcher.feed('gamma', true);
    at(2000);
    matcher.feed('gamma', true);
    expect(onMatch).toHaveBeenCalledTimes(2);
  });

  it('a false guard ignores the match and consumes no debounce', () => {
    let allowed = false;
    const { matcher, onMatch } = setup([{ intent: 'delta', patterns: [/\bdelta\b/], guard: () => allowed }]);
    expect(matcher.feed('delta', true)).toBeNull();
    allowed = true;
    expect(matcher.feed('delta', true)).not.toBeNull();
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('the first matching intent wins and a stateful /g regex still matches on repeat', () => {
    const { matcher, onMatch, at } = setup([
      { intent: 'first', patterns: [/\bshared\b/g] },
      { intent: 'second', patterns: [/\bshared\b/] },
    ]);
    expect(matcher.feed('shared', true)?.intent).toBe('first');
    at(2000);
    expect(matcher.feed('shared', true)?.intent).toBe('first');
    expect(onMatch).toHaveBeenCalledTimes(2);
  });

  it('reset() clears debounce and cooldown state', () => {
    const { matcher, onMatch } = setup([{ intent: 'alpha', patterns: [/\balpha\b/] }]);
    matcher.feed('alpha', true);
    matcher.reset();
    expect(matcher.feed('alpha', true)).not.toBeNull();
    expect(onMatch).toHaveBeenCalledTimes(2);
  });
});
