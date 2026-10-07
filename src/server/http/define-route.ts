// Signature and processing order: 06 3.2 (the contract). Skeleton: 04 3.6.
import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import type { RateLimitRule, ServiceContext } from '@/server/actions/define-action'
import { getConfig } from '@/server/config'
import { ROUTE_BRAND } from '@/server/http/brand'
import { consumeRateLimit } from '@/server/security/rate-limit'
import { getRequestMeta } from '@/server/security/request-meta'

export interface RouteDef<P> {
  name: string // 'raw.get' / 'cron.daily' / 'health'
  auth: 'public' | 'cron' | 'ticket'
  host: 'app' | 'content' // checked here in addition to proxy.ts
  rateLimit: RateLimitRule<P>[] // required for 'ticket' / 'public'
  handler: (ctx: ServiceContext, req: NextRequest, params: P) => Promise<Response>
}

/** Constant-time comparison. Different lengths are false (timingSafeEqual would throw). */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function defineRoute<P>(def: RouteDef<P>) {
  if (def.auth !== 'cron' && def.rateLimit.length === 0) {
    throw new Error(`defineRoute(${def.name}): auth '${def.auth}' requires at least one rateLimit rule (06 3.2)`)
  }

  const run = async (req: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    const requestMeta = await getRequestMeta()
    try {
      const cfg = getConfig()
      // 1. Host
      const expectedHost = new URL(def.host === 'app' ? cfg.APP_ORIGIN : cfg.CONTENT_ORIGIN).host
      if (req.headers.get('host') !== expectedHost) return new NextResponse(null, { status: 404 })

      // 2. cron: Bearer CRON_SECRET (D-015 / D-018 (i): unauthenticated is 401, not 404)
      if (def.auth === 'cron' && !bearerMatches(req.headers.get('authorization'), cfg.CRON_SECRET)) {
        return NextResponse.json({ ok: false }, { status: 401 })
      }

      // 3. rate limits
      const params = await segment.params
      const ctx: ServiceContext = { actor: null, requestMeta, now: new Date(), actionName: def.name }
      for (const rule of def.rateLimit) {
        const key = rule.key(ctx, params)
        if (key === null) continue
        const r = await consumeRateLimit({ name: rule.name, key, limit: rule.limit, windowSec: rule.windowSec }, ctx)
        if (!r.ok) return new NextResponse(null, { status: 429, headers: { 'Retry-After': String(r.retryAfterSec) } })
      }

      // 4. handler
      return await def.handler(ctx, req, params)
    } catch (e) {
      // 5. unexpected: structured log (no headers / body / query) and a 500 without details
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'route.failed',
          route: def.name,
          requestId: requestMeta.requestId,
          error: e instanceof Error ? e.name : 'unknown',
          stack: e instanceof Error ? e.stack : undefined,
        }),
      )
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  }
  return Object.assign(run, { [ROUTE_BRAND]: { name: def.name, auth: def.auth, host: def.host } })
}
