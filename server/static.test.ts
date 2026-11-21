// Regression: production server must serve the built SPA (npm start) with no NODE_ENV set.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp } from './index'

const dist = path.resolve(__dirname, '../dist')
const built = existsSync(path.join(dist, 'index.html'))

describe.skipIf(!built)('static serving of dist/', () => {
  const { http } = createApp()
  let base = ''
  beforeAll(async () => {
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => http.close(() => r())))

  for (const route of ['/glasses', '/phone', '/qr', '/glasses?mirror=1']) {
    it(`serves ${route} as the SPA`, async () => {
      const res = await fetch(base + route)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/html/)
    })
  }
  it('serves the local fonts', async () => {
    const res = await fetch(base + '/fonts/JetBrainsMono-Regular.woff2')
    expect(res.status).toBe(200)
  })
  it('serves the wound fallback image', async () => {
    const res = await fetch(base + '/data/wound-fallback.jpg')
    expect(res.status).toBe(200)
  })
})
