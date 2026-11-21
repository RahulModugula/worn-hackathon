import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isMainModule, sameFileUrl } from './mainModule'

describe('isMainModule', () => {
  it('is false with no argv[1] (REPL, -e)', () => {
    expect(isMainModule(undefined, 'file:///x/index.ts')).toBe(false)
  })
  it('matches the real script path', () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mm-')))
    const f = path.join(dir, 'index.ts')
    writeFileSync(f, '')
    expect(isMainModule(f, pathToFileURL(f).href)).toBe(true)
    expect(isMainModule(path.join(dir, 'other.ts'), pathToFileURL(f).href)).toBe(false)
  })
  it('matches through a symlink (npm bin shims)', () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mm-')))
    const f = path.join(dir, 'index.ts')
    const l = path.join(dir, 'link.ts')
    writeFileSync(f, '')
    symlinkSync(f, l)
    expect(isMainModule(l, pathToFileURL(f).href)).toBe(true)
  })
})

describe('sameFileUrl (Windows shapes)', () => {
  // On Windows, argv[1] is "C:\\proj\\server\\index.ts" while import.meta.url is "file:///C:/proj/server/index.ts".
  // The old path.resolve(argv1) === fileURLToPath(url) check broke on drive-letter case and on 8.3 / slash forms.
  it('matches a drive path against its file URL', () => {
    expect(sameFileUrl('C:\\proj\\server\\index.ts', 'file:///C:/proj/server/index.ts', true)).toBe(true)
  })
  it('ignores drive-letter case on Windows', () => {
    expect(sameFileUrl('c:\\proj\\server\\index.ts', 'file:///C:/proj/server/index.ts', true)).toBe(true)
  })
  it('rejects a different file', () => {
    expect(sameFileUrl('C:\\proj\\server\\other.ts', 'file:///C:/proj/server/index.ts', true)).toBe(false)
  })
})
