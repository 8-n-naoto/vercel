import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const pingDb = vi.fn<() => Promise<void>>()
vi.mock('@/server/db/client', () => ({ pingDb: () => pingDb() }))
vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-health' }),
}))

import { GET as health } from '@/app/api/health/route'
import { GET as daily } from '@/app/api/cron/daily/route'

const SECRET = process.env.CRON_SECRET ?? ''
const none = Promise.resolve({})
const req = (path: string, authorization?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000', ...(authorization ? { authorization } : {}) } })
const bearer = `Bearer ${SECRET}`

beforeEach(() => {
  pingDb.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/health (06 10.3)', () => {
  it('no Bearer -> 401 {"ok":false}', async () => {
    const res = await health(req('/api/health'), { params: none })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('wrong Host -> 404 (content host)', async () => {
    const r = new NextRequest('http://127.0.0.1:3000/api/health', { headers: { host: '127.0.0.1:3000', authorization: bearer } })
    expect((await health(r, { params: none })).status).toBe(404)
  })

  it('all ok -> 200 HealthResponse, no-store', async () => {
    const res = await health(req('/api/health', bearer), { params: none })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ status: 'ok', env: 'local', supabaseProjectRef: 'testref', checks: { db: { ok: true }, storage: { ok: true } } })
    expect(typeof body.totalMs).toBe('number')
    expect(Number.isNaN(Date.parse(body.ts))).toBe(false)
  })

  it('DB failure -> 503 degraded with the error name only; the secret message does not leak', async () => {
    pingDb.mockRejectedValue(new Error('password authentication failed for postgres://user:pass@host sb_secret_x'))
    const res = await health(req('/api/health', bearer), { params: none })
    expect(res.status).toBe(503)
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.status).toBe('degraded')
    expect(body.checks.db).toMatchObject({ ok: false, error: 'Error' })
    expect(body.checks.storage.ok).toBe(true)
    for (const s of ['password', 'postgres', 'sb_secret_', 'pass@', process.env.SUPABASE_SECRET_KEY ?? '', process.env.DATABASE_URL ?? '']) {
      expect(text).not.toContain(s)
    }
  })

  it('Storage failure -> 503, key not in the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })))
    const res = await health(req('/api/health', bearer), { params: none })
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text).checks.storage).toMatchObject({ ok: false, error: 'Error' })
    expect(text).not.toContain(process.env.SUPABASE_SECRET_KEY ?? 'x')
    expect(text).not.toContain('status 401')
  })
})

describe('GET /api/cron/daily (06 10.2)', () => {
  it('no Bearer -> 401', async () => {
    expect((await daily(req('/api/cron/daily'), { params: none })).status).toBe(401)
  })

  it('Bearer -> 200 with the keepalive result', async () => {
    const res = await daily(req('/api/cron/daily', bearer), { params: none })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(1)
    expect(body.results[0]).toMatchObject({ step: 'keepalive', processed: 1, failed: 0 })
  })

  it('keepalive failure is counted in failed and still 200', async () => {
    pingDb.mockRejectedValue(new Error('boom sb_secret_x'))
    const res = await daily(req('/api/cron/daily', bearer), { params: none })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text).results[0]).toMatchObject({ step: 'keepalive', processed: 0, failed: 1 })
    expect(text).not.toContain('boom')
  })
})
