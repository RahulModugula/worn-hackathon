/*
 * Legacy WebView polyfills for /glasses (Android 9 WebView, Chromium ~69, factory version unknown).
 * Hand-written, no core-js. Each one only installs when the engine lacks the API.
 * Imported first in main.tsx. Remove an entry once scripts/check-legacy.mjs reports no use of its API.
 * See docs/COMPAT-PERF.md.
 */

const hasOwnDefine = (target: object, name: PropertyKey): boolean => name in target;

const install = (target: object, name: string, value: unknown): void => {
  if (hasOwnDefine(target, name)) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
};

// Object.fromEntries (Chromium 73)
install(Object, 'fromEntries', function fromEntries(entries: Iterable<readonly [PropertyKey, unknown]>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) out[String(key)] = value;
  return out;
});

// Array.prototype.at (Chromium 92)
install(Array.prototype, 'at', function at(this: ArrayLike<unknown>, index: number) {
  const len = this.length;
  let i = Math.trunc(index) || 0;
  if (i < 0) i += len;
  return i < 0 || i >= len ? undefined : this[i];
});

// Promise.allSettled (Chromium 76)
install(Promise, 'allSettled', function allSettled(items: Iterable<unknown>) {
  return Promise.all(
    Array.from(items, (item) =>
      Promise.resolve(item).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
    ),
  );
});

// queueMicrotask (Chromium 71). Errors are rethrown asynchronously, as the native API does.
install(typeof globalThis !== 'undefined' ? globalThis : window, 'queueMicrotask', function queueMicrotask(cb: () => void) {
  Promise.resolve()
    .then(cb)
    .catch((err: unknown) => {
      setTimeout(() => {
        throw err;
      }, 0);
    });
});

// structuredClone (Chromium 98). Plain data only: JSON round-trip drops Map, Set, Date and undefined fields.
install(typeof globalThis !== 'undefined' ? globalThis : window, 'structuredClone', function structuredClone(value: unknown) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
});

// AbortSignal.timeout (Chromium 103). Built on AbortController + setTimeout.
if (typeof AbortSignal !== 'undefined') {
  install(AbortSignal, 'timeout', function timeout(ms: number) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}
