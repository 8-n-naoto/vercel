// 06 10.1: serves an uploaded HTML file on the content origin with a one-time ticket. GET only; HEAD is exported explicitly and answers 405
// (Next.js would otherwise run the GET handler for HEAD and consume the ticket, F-008). No other method is exported (Next.js answers 405).
import { defineRoute } from '@/server/http/define-route'
import { rawErrorHeaders } from '@/server/security/headers'
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

export const HEAD = defineRoute<{ ticket: string }>({
  name: 'raw.head',
  auth: 'ticket',
  host: 'content',
  // No DB access at all: the rule is declared (defineRoute requires one for 'ticket') but its key is always null, so it is skipped.
  rateLimit: [{ name: 'raw:ip', key: () => null, limit: 120, windowSec: 60 }],
  handler: async () => new Response('Method Not Allowed', { status: 405, headers: { ...rawErrorHeaders(), Allow: 'GET' } }),
})
