import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Runs polyfills.ts in a fresh VM context whose built-ins have been stripped of the APIs an
// Android 9 WebView (Chromium ~69) lacks. An isolated context keeps the test runner's own
// globals intact (stripping them in-process breaks vitest). Covers each polyfill's install path.
const SRC = resolve('src/polyfills.ts');

function loadPolyfills() {
  const js = ts.transpileModule(readFileSync(SRC, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None },
  }).outputText;
  // A stand-in AbortSignal with no timeout(): the host's AbortSignal must not be mutated.
  const sandbox: Record<string, unknown> = { setTimeout, AbortController, AbortSignal: function AbortSignal() {}, console };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(
    `delete Object.fromEntries; delete Array.prototype.at; delete Promise.allSettled;
     delete globalThis.queueMicrotask; delete globalThis.structuredClone; delete AbortSignal.timeout;`,
    ctx,
  );
  const missing = vm.runInContext(
    `[typeof Object.fromEntries, typeof Array.prototype.at, typeof Promise.allSettled, typeof queueMicrotask,
      typeof structuredClone, typeof AbortSignal.timeout]`,
    ctx,
  );
  expect(missing).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  vm.runInContext(js, ctx, { filename: 'polyfills.js' });
  return (expr: string) => vm.runInContext(expr, ctx);
}

describe('legacy polyfills', () => {
  it('installs each missing API and the replacements behave', async () => {
    const g = loadPolyfills();
    expect(g('Object.fromEntries([["a", 1], ["b", 2]])')).toEqual({ a: 1, b: 2 });
    expect(g('[1, 2, 3].at(-1)')).toBe(3);
    expect(g('[1, 2, 3].at(5)')).toBeUndefined();
    const settled = await g('Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("x"))])');
    expect(settled.map((s: { status: string }) => s.status)).toEqual(['fulfilled', 'rejected']);
    expect(g('structuredClone({ n: [1, { m: "x" }] })')).toEqual({ n: [1, { m: 'x' }] });

    const order: string[] = [];
    const push = g('(cb) => queueMicrotask(cb)') as (cb: () => void) => void;
    push(() => order.push('micro'));
    order.push('sync');
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['sync', 'micro']);

    const signal = g('AbortSignal.timeout(5)') as AbortSignal;
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(true);
  });
});
