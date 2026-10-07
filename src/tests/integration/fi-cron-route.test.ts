// FI-3 automated half (T-051): the HTTP surface of GET /api/cron/daily seen by the operator of runbook 3.
//   (a) wrong / missing Bearer -> 401, nothing runs.   (b) a failing step -> HTTP 200 with results[].failed = 1 and later steps still run;
//   a failure outside the steps -> 500.   (c) wrong Host -> 404 even with the right Bearer (04 11 S5 symptom).
// No database or Storage is touched: the steps run against a failing in-memory store, keepalive is a no-op. It needs only the
// configuration that setup.ts loads. Existing coverage is not repeated: CR-17 (step exception at service level), define-route.test (401 / 404 matrix).
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '@/server/config'

vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: '127.0.0.1', userAgent: 'vitest', requestId: 'it-fi-cron' }),
}))

const calls = { order: [] as string[], failStep2: true, throwAll: false }

vi.mock('@/server/services/cron/daily', async (orig) => {
  const actual = await orig<typeof import('@/server/services/cron/daily')>()
  const store = {
    abandonPending: async () => {
      calls.order.push('pending_cleanup')
      if (calls.failStep2) throw new Error('injected')
      return []
    },
    expireFiles: async () => {
      calls.order.push('expired_files')
      return []
    },
    listUnpurged: async () => {
      calls.order.push('purge_retry')
      return []
    },
    markPurged: async () => {},
  }
  return {
    ...actual,
    runDaily: async () => {
      if (calls.throwAll) throw new Error('injected-outside-steps')
      return actual.runDaily({ store, keepalive: async () => {} })
    },
  }
})

const { GET } = await import('@/app/api/cron/daily/route')

const cfg = getConfig()
const appHost = new URL(cfg.APP_ORIGIN).host
const none = Promise.resolve({})
const call = (host: string, authorization?: string) =>
  GET(new NextRequest('http://localhost/api/cron/daily', { headers: { host, ...(authorization ? { authorization } : {}) } }), { params: none })

afterEach(() => {
  calls.order.length = 0
  calls.failStep2 = true
  calls.throwAll = false
  vi.restoreAllMocks()
})

describe('FI-3 /api/cron/daily failure surface', () => {
  it('FI-3a: a missing / wrong Bearer (CRON_SECRET mismatch) -> 401 {"ok":false} and no step runs', async () => {
    for (const authorization of [undefined, 'Bearer wrong-secret']) {
      const res = await call(appHost, authorization)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ ok: false })
    }
    expect(calls.order).toEqual([])
  })

  it('FI-3b: a failing step -> HTTP 200, ok true, that step failed 1, the later steps still ran', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(appHost, `Bearer ${cfg.CRON_SECRET}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { ok: boolean; results: { step: string; failed: number }[] }
    expect(body.ok).toBe(true)
    expect(body.results.find((r) => r.step === 'pending_cleanup')?.failed).toBe(1)
    expect(body.results.filter((r) => r.failed === 0).map((r) => r.step)).toEqual(expect.arrayContaining(['keepalive', 'expired_files', 'purge_retry']))
    expect(calls.order).toEqual(['pending_cleanup', 'expired_files', 'purge_retry'])
  })

  it('FI-3b: after the cause is removed the next run reports failed 0 on every step (recovery check of runbook 3)', async () => {
    calls.failStep2 = false
    const body = (await (await call(appHost, `Bearer ${cfg.CRON_SECRET}`)).json()) as { results: { failed: number }[] }
    expect(body.results.length).toBeGreaterThanOrEqual(4)
    expect(body.results.every((r) => r.failed === 0)).toBe(true)
  })

  it('FI-3b: a failure outside the steps (runDaily itself rejects) -> 500 {"ok":false} with no details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    calls.throwAll = true
    const res = await call(appHost, `Bearer ${cfg.CRON_SECRET}`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('FI-3c: a Host other than APP_ORIGIN (Cron destination mismatch) -> 404 even with the right Bearer, nothing runs', async () => {
    const other = new URL(cfg.CONTENT_ORIGIN).host === appHost ? 'other.invalid' : new URL(cfg.CONTENT_ORIGIN).host
    for (const host of [other, 'unknown.invalid']) {
      expect((await call(host, `Bearer ${cfg.CRON_SECRET}`)).status).toBe(404)
    }
    expect(calls.order).toEqual([])
  })
})
