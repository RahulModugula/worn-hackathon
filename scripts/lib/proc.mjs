// Tiny process helpers shared by ship / rollback / health. Windows-safe (npm is npm.cmd there).
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';

/** Run a command, inherit output. Returns the exit code. */
export function runInherit(cmd, args, opts = {}) {
  const r = spawnSync(isWin && cmd === 'npm' ? 'npm.cmd' : cmd, args, { stdio: 'inherit', shell: isWin && cmd === 'npm', ...opts });
  return r.status ?? 1;
}

/** Run a command, capture output. Returns {code, out, err}. */
export function runCapture(cmd, args, opts = {}) {
  const r = spawnSync(isWin && cmd === 'npm' ? 'npm.cmd' : cmd, args, { encoding: 'utf8', shell: isWin && cmd === 'npm', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export const git = (args, opts) => runCapture('git', args, opts);
