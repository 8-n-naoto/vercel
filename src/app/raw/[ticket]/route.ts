// 06 10.1: serves an uploaded HTML file on the content origin with a one-time ticket. Only GET is exported (no HEAD, so Next.js answers 405).
import { defineRoute } from '@/server/http/define-route'
import { rateLimitKey } from '@/server/security/rate-limit'
import { deliveryService } from '@/server/services/delivery'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export const GET = defineRoute<{ ticket: string }>({
  name: 'raw.get',
  auth: 'ticket',
  host: 'content',
  rateLimit: [{ name: 'raw:ip', key: (ctx) => rateLimitKey('raw:ip', { ip: ctx.requestMeta.ip }), limit: 120, windowSec: 60 }],
  handler: (ctx, req, params) => deliveryService.serveTicket(ctx, params.ticket, req.headers.get('sec-fetch-dest')),
})
