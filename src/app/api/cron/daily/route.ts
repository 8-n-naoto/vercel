// 06 10.2: Phase 0 implements step 1 (keepalive) only. 200 even when a step failed (counted in `failed`).
import { NextResponse } from 'next/server'
import { defineRoute } from '@/server/http/define-route'
import { runDaily } from '@/server/services/cron/daily'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = defineRoute<Record<string, never>>({
  name: 'cron.daily',
  auth: 'cron',
  host: 'app',
  rateLimit: [],
  handler: async () => NextResponse.json({ ok: true, results: await runDaily() }, { headers: { 'Cache-Control': 'no-store' } }),
})
