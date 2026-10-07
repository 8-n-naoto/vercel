import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { redirect, notFound } from 'next/navigation'
import { appError } from '@/lib/errors'
import { ACTION_BRAND } from '@/server/actions/brand'
import { defineAction, mapPgError, type ActionDef } from '@/server/actions/define-action'
import * as session from '@/server/authz/session'
import * as rateLimit from '@/server/security/rate-limit'

vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-test-1' }),
}))
vi.mock('@/server/authz/session', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  clearSessionCookies: vi.fn(async () => {}),
}))
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true })),
}))

const actor = { userId: 'u1', email: 'a@example.com', displayName: 'A', role: 'admin' as const }
const input = z.object({ name: z.string().min(1).max(10) })
type In = z.infer<typeof input>

beforeEach(() => {
  vi.mocked(session.requireUser).mockReset().mockResolvedValue(actor)
  vi.mocked(session.requireAdmin).mockReset().mockResolvedValue(actor)
  vi.mocked(session.clearSessionCookies).mockClear()
  vi.mocked(rateLimit.consumeRateLimit).mockReset().mockResolvedValue({ ok: true })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const make = (over: Partial<ActionDef<In, unknown>> = {}) =>
  defineAction<In, unknown>({
    name: 'test.run',
    auth: 'user',
    input,
    rateLimit: [],
    handler: async (_ctx, i) => ({ echoed: i.name }),
    ...over,
  })

describe('defineAction processing order (06 3.1)', () => {
  it('success: returns { ok: true, data } and logs action.done without the input', async () => {
    const r = await make()({ name: 'abc' })
    expect(r).toEqual({ ok: true, data: { echoed: 'abc' } })
    const line = String(vi.mocked(console.log).mock.calls[0]?.[0])
    expect(JSON.parse(line)).toMatchObject({ event: 'action.done', action: 'test.run', userId: 'u1', ok: true, requestId: 'req-test-1' })
    expect(line).not.toContain('abc')
  })

  it('void handler returns data: null', async () => {
    const r = await make({ handler: async () => undefined })({ name: 'abc' })
    expect(r).toEqual({ ok: true, data: null })
  })

  it('validation failure -> VALIDATION_FAILED with Japanese fieldErrors, before authentication', async () => {
    const r = await make()({ name: '' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('VALIDATION_FAILED')
    expect(r.error.message).toBe('入力内容を確認してください')
    expect(r.error.fieldErrors?.name?.[0]).toMatch(/[ぁ-ん]/)
    expect(session.requireUser).not.toHaveBeenCalled()
  })

  it('non-object input is also VALIDATION_FAILED (form-level key _form)', async () => {
    const r = await make()('not an object')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.error.fieldErrors ?? {})).toEqual(['_form'])
  })

  it('UNAUTHENTICATED -> ok:false and the session cookies are cleared; the handler does not run', async () => {
    vi.mocked(session.requireUser).mockRejectedValue(appError('UNAUTHENTICATED', 'common.unauthenticated'))
    const handler = vi.fn(async () => 1)
    const r = await make({ handler })({ name: 'abc' })
    expect(r).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    expect(session.clearSessionCookies).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('FORBIDDEN from requireAdmin does not clear cookies', async () => {
    vi.mocked(session.requireAdmin).mockRejectedValue(appError('FORBIDDEN', 'common.forbidden'))
    const r = await make({ auth: 'admin' })({ name: 'abc' })
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(session.clearSessionCookies).not.toHaveBeenCalled()
  })

  it('public: no authentication call, ctx.actor is null', async () => {
    let seen: unknown = 'unset'
    const a = make({
      auth: 'public',
      rateLimit: [{ name: 'x:ip', key: () => 'k', limit: 1, windowSec: 1 }],
      handler: async (ctx) => {
        seen = ctx.actor
        return 1
      },
    })
    expect(await a({ name: 'abc' })).toEqual({ ok: true, data: 1 })
    expect(seen).toBeNull()
    expect(session.requireUser).not.toHaveBeenCalled()
    expect(session.requireAdmin).not.toHaveBeenCalled()
  })

  it('public with an empty rateLimit is rejected at definition time', () => {
    expect(() => make({ auth: 'public', rateLimit: [] })).toThrow(/rateLimit/)
  })

  it('user/admin: mutation:user (120 / 60s) is evaluated first, then the declared rules in order', async () => {
    const order: string[] = []
    vi.mocked(rateLimit.consumeRateLimit).mockImplementation(async (rule) => {
      order.push(`${rule.name}|${rule.key}|${rule.limit}|${rule.windowSec}`)
      return { ok: true }
    })
    await make({
      rateLimit: [
        { name: 'a', key: () => 'ka', limit: 5, windowSec: 10 },
        { name: 'b', key: () => null, limit: 1, windowSec: 1 },
      ],
    })({ name: 'abc' })
    expect(order).toEqual(['mutation:user|mutation:user:u1|120|60', 'a|ka|5|10']) // rule b returned null -> not applied
  })

  it('rate limit exceeded -> RATE_LIMITED with retryAfterSec; later rules and the handler are skipped', async () => {
    vi.mocked(rateLimit.consumeRateLimit).mockResolvedValue({ ok: false, retryAfterSec: 42 })
    const handler = vi.fn(async () => 1)
    const r = await make({ handler, rateLimit: [{ name: 'a', key: () => 'ka', limit: 1, windowSec: 1 }] })({ name: 'abc' })
    expect(r).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryAfterSec: 42 } })
    expect(rateLimit.consumeRateLimit).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('AppError thrown by the handler -> ok:false with the same shape', async () => {
    const r = await make({
      handler: async () => {
        throw appError('NOT_FOUND', 'common.not_found')
      },
    })({ name: 'abc' })
    expect(r).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: '対象が見つかりません。画面を再読み込みしてください' } })
  })

  it('unexpected error -> INTERNAL with requestId and no stack / message in the response; action.failed is logged', async () => {
    const r = await make({
      handler: async () => {
        throw new Error('secret connection string postgres://u:p@h/db')
      },
    })({ name: 'abc' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INTERNAL')
    expect(r.error.requestId).toBe('req-test-1')
    expect(r.error.message).toContain('req-test-1')
    expect(JSON.stringify(r)).not.toContain('postgres://')
    expect(JSON.stringify(r)).not.toContain(' at ')
    const logged = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))
    expect(logged).toMatchObject({ event: 'action.failed', action: 'test.run', requestId: 'req-test-1' })
  })

  it.each([['40P01'], ['55P03'], ['40001'], ['23505']])('PostgreSQL %s (also wrapped in cause) -> CONFLICT', async (code) => {
    const direct = await make({
      handler: async () => {
        throw Object.assign(new Error('pg'), { code })
      },
    })({ name: 'abc' })
    expect(direct).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const wrapped = await make({
      handler: async () => {
        throw new Error('wrapped', { cause: Object.assign(new Error('pg'), { code }) })
      },
    })({ name: 'abc' })
    expect(wrapped).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  })

  it('57014 (statement_timeout) -> INTERNAL', async () => {
    expect(mapPgError('57014')).toBeNull()
    const r = await make({
      handler: async () => {
        throw Object.assign(new Error('timeout'), { code: '57014' })
      },
    })({ name: 'abc' })
    expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
  })

  it('redirect() and notFound() are re-thrown (unstable_rethrow), not turned into INTERNAL', async () => {
    await expect(make({ handler: async () => redirect('/folders') })({ name: 'abc' })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })
    await expect(make({ handler: async () => notFound() })({ name: 'abc' })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK'),
    })
  })

  it('carries the brand with name and auth (used by authz-coverage)', () => {
    const a = make({ name: 'x.y', auth: 'admin' })
    expect(a[ACTION_BRAND]).toEqual({ name: 'x.y', auth: 'admin' })
  })
})
