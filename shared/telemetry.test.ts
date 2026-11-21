import { describe, it, expect } from 'vitest'
import { p50, maxOf, chromeVersion } from './telemetry'

describe('telemetry helpers', () => {
  it('p50 and max', () => {
    expect(p50([])).toBeNull()
    expect(maxOf([])).toBeNull()
    expect(p50([300, 100, 200])).toBe(200)
    expect(p50([400, 100, 200, 300])).toBe(200)
    expect(maxOf([300, 100, 200])).toBe(300)
  })
  it('reads the WebView Chrome version', () => {
    expect(chromeVersion('Mozilla/5.0 (Linux; Android 11; M6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.163 Mobile Safari/537.36')).toBe('119.0.6045.163')
    expect(chromeVersion('Mozilla/5.0 (iPhone) AppleWebKit/605 Safari/604')).toBeNull()
  })
})
