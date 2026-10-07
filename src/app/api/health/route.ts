// 06 10.3 (D-015 / D-018 (i)): Bearer CRON_SECRET required; 401 otherwise (handled by defineRoute).
import { NextResponse } from 'next/server'
import { defineRoute } from '@/server/http/define-route'
import { checkHealth } from '@/server/services/health'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const GET = defineRoute<Record<string, never>>({
  name: 'health',
  auth: 'cron',
  host: 'app',
  rateLimit: [],
  handler: async () => {
    const body = await checkHealth()
    return NextResponse.json(body, { status: body.status === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
  },
})
