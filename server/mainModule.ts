import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Compares a script path with an import.meta.url. `windows` forces Windows semantics (tests run on any OS). */
export function sameFileUrl(argv1: string, metaUrl: string, windows = process.platform === 'win32'): boolean {
  const a = pathToFileURL(argv1, { windows }).href
  return windows ? a.toLowerCase() === metaUrl.toLowerCase() : a === metaUrl
}

/** True when this module is the process entry point. Windows-safe: no path.resolve vs fileURLToPath string compare. */
export function isMainModule(argv1: string | undefined, metaUrl: string): boolean {
  if (!argv1) return false
  if (sameFileUrl(argv1, metaUrl)) return true
  try { return sameFileUrl(realpathSync(argv1), metaUrl) } catch { return false }
}
