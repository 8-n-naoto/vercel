// S3: 20 concurrent requests against /api/health.  run: BASE=http://localhost:3000 npx tsx scripts/spike/s3-connections.ts
// Needs DB connection and a running server (npm run dev / next start). Reads CRON_SECRET from .env.local, never prints it.
import { requireDevEnv } from './_guard'
requireDevEnv()

const base = process.env.BASE ?? 'http://localhost:3000'
const token = process.env.CRON_SECRET
if (!token) {
  console.error('CRON_SECRET is not set')
  process.exit(1)
}
type Health = { checks?: { db?: { ok?: boolean; error?: string } } }
const results = await Promise.all(
  Array.from({ length: 20 }, async () => {
    const t = Date.now()
    try {
      const res = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${token}` } })
      const body = (await res.json().catch(() => ({}))) as Health
      return { status: res.status, dbOk: body.checks?.db?.ok ?? null, err: body.checks?.db?.error ?? null, ms: Date.now() - t }
    } catch (e) {
      return { status: 0, dbOk: null, err: e instanceof Error ? e.message : String(e), ms: Date.now() - t }
    }
  }),
)
const failed = results.filter((r) => r.status !== 200 || r.dbOk !== true)
console.error(`total=20 failed=${failed.length} maxMs=${Math.max(...results.map((r) => r.ms))}`)
for (const f of failed) console.error(`failed: status=${f.status} err=${f.err}`)
