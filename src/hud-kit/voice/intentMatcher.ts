/** Generic intent matcher over transcripts. Knows nothing about any app's vocabulary. */

export interface IntentSpec {
  intent: string;
  /** Matched against the lower-cased, trimmed transcript. Any pattern matching is a hit. */
  patterns: RegExp[];
  /**
   * Optional guard. When it returns false the match is ignored and neither the debounce nor the
   * cooldown is consumed.
   */
  guard?: () => boolean;
  /** Cooldown per (intent, cooldownKey). Applies only when feed() is given a cooldownKey. */
  cooldownMs?: number;
}

export interface IntentMatch {
  intent: string;
  /** Lower-cased, trimmed transcript that matched. */
  text: string;
  final: boolean;
  cooldownKey?: string;
}

export interface IntentMatcherOptions {
  intents: IntentSpec[];
  onMatch: (match: IntentMatch) => void;
  /** Per-intent debounce across interim and final results. Default 1500 ms. */
  debounceMs?: number;
  now?: () => number;
}

export interface IntentMatcher {
  /** Feeds one transcript (interim or final). Returns the match that fired, or null. */
  feed(text: string, final: boolean, cooldownKey?: string): IntentMatch | null;
  reset(): void;
}

export const DEFAULT_DEBOUNCE_MS = 1500;

export function createIntentMatcher(options: IntentMatcherOptions): IntentMatcher {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = options.now ?? Date.now;
  const lastFired = new Map<string, number>();
  const lastFiredByKey = new Map<string, number>();

  return {
    feed(text, final, cooldownKey) {
      const normalized = text.trim().toLowerCase();
      if (normalized.length === 0) return null;

      for (const spec of options.intents) {
        const hit = spec.patterns.some((pattern) => {
          pattern.lastIndex = 0; // guard against stateful /g regexes
          return pattern.test(normalized);
        });
        if (!hit) continue;
        if (spec.guard && !spec.guard()) continue;

        const t = now();
        const last = lastFired.get(spec.intent);
        if (last !== undefined && t - last < debounceMs) return null;

        const keyed = spec.cooldownMs !== undefined && cooldownKey !== undefined;
        const keyId = keyed ? `${spec.intent}\u0000${cooldownKey}` : '';
        if (keyed) {
          const lastKeyed = lastFiredByKey.get(keyId);
          if (lastKeyed !== undefined && t - lastKeyed < (spec.cooldownMs as number)) return null;
        }

        lastFired.set(spec.intent, t);
        if (keyed) lastFiredByKey.set(keyId, t);
        const match: IntentMatch = { intent: spec.intent, text: normalized, final, cooldownKey };
        options.onMatch(match);
        return match;
      }
      return null;
    },
    reset() {
      lastFired.clear();
      lastFiredByKey.clear();
    },
  };
}
