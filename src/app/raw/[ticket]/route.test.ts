import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ROUTE_BRAND } from '@/server/http/brand'
import * as rateLimit from '@/server/security/rate-limit'
import * as routeModule from './route'
import { GET } from './route'

vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: '203.0.113.9', userAgent: 'vitest', requestId: 'req-raw' }),
}))
vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))
vi.mock('@/server/security/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/server/security/rate-limit')>()),
  consumeRateLimit: vi.fn(async () => ({ ok: true })),
}))

// src/tests/setup.ts: APP_ORIGIN=http://localhost:3000, CONTENT_ORIGIN=http://127.0.0.1:3000
const TICKET = 'T'.repeat(43)
const call = (host: string, ticket: string) =>
  GET(new NextRequest(`http://${host}/raw/${ticket}`, { headers: { host } }), { params: Promise.resolve({ ticket }) })

beforeEach(() => {
  vi.mocked(rateLimit.consumeRateLimit).mockClear().mockResolvedValue({ ok: true })
})

describe('GET /raw/[ticket] route definition (06 10.1)', () => {
  it('is defineRoute(raw.get, ticket, content) and exports GET only (no HEAD / POST), with the runtime settings', () => {
    expect(GET[ROUTE_BRAND]).toEqual({ name: 'raw.get', auth: 'ticket', host: 'content' })
    expect(Object.keys(routeModule).sort()).toEqual(['GET', 'dynamic', 'maxDuration', 'runtime'])
    expect(routeModule.dynamic).toBe('force-dynamic')
    expect(routeModule.runtime).toBe('nodejs')
    expect(routeModule.maxDuration).toBe(300)
  })

  it('the app host answers 404 (Host check), without rate limiting or any lookup', async () => {
    const r = await call('localhost:3000', TICKET)
    expect(r.status).toBe(404)
    expect(rateLimit.consumeRateLimit).not.toHaveBeenCalled()
  })

  it('content host + malformed ticket -> 404 with the fixed English body; the rate limit raw:ip (120 / 60 s) was consumed first', async () => {
    const r = await call('127.0.0.1:3000', 'not-a-ticket')
    expect(r.status).toBe(404)
    expect(await r.text()).toBe('Not Found')
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(rateLimit.consumeRateLimit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(rateLimit.consumeRateLimit).mock.calls[0]?.[0]).toEqual({ name: 'raw:ip', key: 'raw:ip:203.0.113.9', limit: 120, windowSec: 60 })
  })

  it('rate limit exceeded -> 429 with Retry-After before any lookup', async () => {
    vi.mocked(rateLimit.consumeRateLimit).mockResolvedValue({ ok: false, retryAfterSec: 9 })
    const r = await call('127.0.0.1:3000', TICKET)
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('9')
  })
})
