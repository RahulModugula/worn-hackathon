// Real server, in its own process, for the soak test. Prints `READY <port>` when listening.
// Adds GET /__stress (RSS, heap after optional GC, event-loop delay, crash counters) through the server's own hooks option.
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { startServer } from '../../server/index.ts'

const counters = { uncaught: 0, unhandled: 0 }
process.on('uncaughtException', e => { counters.uncaught++; console.error('UNCAUGHT', e && e.stack || e) })
process.on('unhandledRejection', e => { counters.unhandled++; console.error('UNHANDLED', e && e.stack || e) })

const h = monitorEventLoopDelay({ resolution: 10 })
h.enable()
// monitorEventLoopDelay reports timer delay INCLUDING its 10 ms sampling resolution; subtract it so 0 means idle.
const ms = ns => Math.max(0, Math.round(ns / 1e4) / 100 - 10)

const srv = await startServer({
  host: '127.0.0.1', port: 0,
  drReplyDelayMs: Number(process.env.DR_DELAY_MS ?? 5000),
  hooks: app => {
    app.get('/__stress', (req, res) => {
      if (req.query.gc === '1' && globalThis.gc) globalThis.gc()
      const m = process.memoryUsage()
      const out = {
        rssMb: Math.round(m.rss / 1048576 * 10) / 10, heapUsedMb: Math.round(m.heapUsed / 1048576 * 10) / 10,
        eventLoopMs: { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max), mean: ms(h.mean) },
        ...counters,
      }
      if (req.query.reset === '1') h.reset()
      res.json(out)
    })
  },
})
console.log(`READY ${srv.port}`)
