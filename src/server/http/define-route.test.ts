import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ROUTE_BRAND } from '@/server/http/brand'
import { bearerMatches, defineRoute } from '@/server/http/define-route'
import * as rateLimit from '@/server/security/rate-limit'

vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-test-2' }),
}))
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true })),
}))

// src/tests/setup.ts: APP_ORIGIN=http://localhost:3000, CONTENT_ORIGIN=http://127.0.0.1:3000, CRON_SECRET=test-cron-secret-...
const SECRET = process.env.CRON_SECRET ?? ''
const none = Promise.resolve({})

function req(host: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/x', { headers: { host, ...headers } })
}

const cron = (handler = vi.fn(async () => Response.json({ ok: true }))) =>
  defineRoute<Record<string, never>>({ name: 'cron.test', auth: 'cron', host: 'app', rateLimit: [], handler })

beforeEach(() => {
  vi.mocked(rateLimit.consumeRateLimit).mockReset().mockResolvedValue({ ok: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('defineRoute (06 3.2)', () => {
  it('cron: Bearer mismatch -> 401 {"ok":false}; the handler does not run', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }))
    for (const authorization of [undefined, 'Bearer wrong', `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, SECRET, `bearer ${SECRET}`]) {
      const res = await cron(handler)(req('localhost:3000', authorization ? { authorization } : {}), { params: none })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ ok: false })
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('cron: correct Bearer -> the handler result', async () => {
    const res = await cron()(req('localhost:3000', { authorization: `Bearer ${SECRET}` }), { params: none })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('Host mismatch -> 404 before the Bearer is checked (even with a correct Bearer)', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }))
    for (const host of ['127.0.0.1:3000', 'unknown.example', 'localhost']) {
      const res = await cron(handler)(req(host, { authorization: `Bearer ${SECRET}` }), { params: none })
      expect(res.status).toBe(404)
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it("host: 'content' accepts only CONTENT_ORIGIN's host", async () => {
    const r = defineRoute<{ ticket: string }>({
      name: 'raw.test',
      auth: 'ticket',
      host: 'content',
      rateLimit: [{ name: 'raw:ip', key: () => 'ip', limit: 1, windowSec: 1 }],
      handler: async (_c, _r, p) => Response.json({ ticket: p.ticket }),
    })
    expect((await r(req('localhost:3000'), { params: Promise.resolve({ ticket: 't' }) })).status).toBe(404)
    const ok = await r(req('127.0.0.1:3000'), { params: Promise.resolve({ ticket: 't' }) })
    expect(await ok.json()).toEqual({ ticket: 't' })
  })

  it('rate limit exceeded -> 429 with Retry-After', async () => {
    vi.mocked(rateLimit.consumeRateLimit).mockResolvedValue({ ok: false, retryAfterSec: 7 })
    const r = defineRoute<{ ticket: string }>({
      name: 'raw.test',
      auth: 'ticket',
      host: 'app',
      rateLimit: [{ name: 'raw:ip', key: () => 'ip', limit: 1, windowSec: 1 }],
      handler: async () => Response.json({}),
    })
    const res = await r(req('localhost:3000'), { params: Promise.resolve({ ticket: 't' }) })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('7')
  })

  it('unexpected error -> 500 {"ok":false} without details, and route.failed is logged with requestId', async () => {
    const r = cron(
      vi.fn(async () => {
        throw new Error('boom postgres://u:p@h/db')
      }),
    )
    const res = await r(req('localhost:3000', { authorization: `Bearer ${SECRET}` }), { params: none })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: false })
    expect(text).not.toContain('boom')
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0]))).toMatchObject({
      event: 'route.failed',
      route: 'cron.test',
      requestId: 'req-test-2',
    })
  })

  it("'ticket' / 'public' without rateLimit is rejected at definition time; the brand carries name / auth / host", () => {
    const base = { name: 'x', host: 'app' as const, handler: async () => Response.json({}) }
    expect(() => defineRoute({ ...base, auth: 'ticket', rateLimit: [] })).toThrow(/rateLimit/)
    expect(() => defineRoute({ ...base, auth: 'public', rateLimit: [] })).toThrow(/rateLimit/)
    expect(cron()[ROUTE_BRAND]).toEqual({ name: 'cron.test', auth: 'cron', host: 'app' })
  })
})

describe('bearerMatches', () => {
  it('compares in constant time and treats length differences as false', () => {
    expect(bearerMatches('Bearer abc', 'abc')).toBe(true)
    expect(bearerMatches('Bearer abcd', 'abc')).toBe(false)
    expect(bearerMatches('Bearer ab', 'abc')).toBe(false)
    expect(bearerMatches('Bearer ', 'abc')).toBe(false)
    expect(bearerMatches(null, 'abc')).toBe(false)
  })
})

describe('defineRoute error headers on the content origin (F-007, 06 10.1)', () => {
  const expectRawErrorHeaders = (res: Response) => {
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  }
  const content = (handler: () => Promise<Response>) =>
    defineRoute<{ ticket: string }>({
      name: 'raw.test',
      auth: 'ticket',
      host: 'content',
      rateLimit: [{ name: 'raw:ip', key: () => 'ip', limit: 1, windowSec: 1 }],
      handler,
    })
  const p = { params: Promise.resolve({ ticket: 't' }) }

  it('404 (host mismatch), 429 and 500 carry the raw error headers; 429 keeps Retry-After', async () => {
    const r = content(async () => {
      throw new Error('boom')
    })
    expectRawErrorHeaders(await r(req('localhost:3000'), p))
    vi.mocked(rateLimit.consumeRateLimit).mockResolvedValueOnce({ ok: false, retryAfterSec: 7 })
    const limited = await r(req('127.0.0.1:3000'), p)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('7')
    expectRawErrorHeaders(limited)
    const failed = await r(req('127.0.0.1:3000'), p)
    expect(failed.status).toBe(500)
    expectRawErrorHeaders(failed)
    expect(await failed.json()).toEqual({ ok: false })
  })

  it('app-origin routes do not get the raw error headers', async () => {
    const res = await cron()(req('localhost:3000'), { params: none })
    expect(res.headers.get('x-robots-tag')).toBeNull()
  })
})
