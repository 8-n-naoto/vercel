import { beforeEach, describe, it, expect, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import { recordStandalone } from '@/server/services/audit'
import { incrementRateLimit } from '@/server/services/rate-limit-store'
import { consumeRateLimit, decideRateLimit, rateLimitKey } from './rate-limit'
import { DECIDE_CASES, DECIDE_X_CASES, KEY_CASES, KEY_X_CASES } from '@/tests/fixtures/rate-limit'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

vi.mock('@/server/services/rate-limit-store', () => ({ incrementRateLimit: vi.fn() }))
vi.mock('@/server/services/audit', () => ({ recordStandalone: vi.fn() }))

describe('07 5.2 coverage', () => {
  itCoversSpec07('RL', [...DECIDE_CASES, ...KEY_CASES].map((c) => c.id), { integrationFrom: 8 })
})

describe('decideRateLimit (07 5.2)', () => {
  it.each(DECIDE_CASES)('$id', ({ count, limit, retry, expected }) => {
    expect(decideRateLimit(count, limit, retry)).toEqual(expected)
  })
})

describe('rateLimitKey (07 5.2)', () => {
  it.each(KEY_CASES)('$id', ({ rule, parts, expected }) => {
    expect(rateLimitKey(rule, parts)).toBe(expected)
  })
})

describe('boundaries outside 07 (T-018)', () => {
  it.each(DECIDE_X_CASES)('$id decideRateLimit', ({ count, limit, retry, expected }) => {
    expect(decideRateLimit(count, limit, retry)).toEqual(expected)
  })
  it.each(KEY_X_CASES)('$id rateLimitKey', ({ rule, parts, expected }) => {
    expect(rateLimitKey(rule, parts)).toBe(expected)
  })
  // Judgement requested in the T-018 report: the implementation returns a non-integer / NaN retryAfterSec.
  it.todo('RL-X12 decideRateLimit: retry 1.5 should give an integer retryAfterSec (Retry-After header)')
  it.todo('RL-X13 decideRateLimit: retry NaN should not produce a NaN retryAfterSec')
  it.todo('RL-X14 rateLimitKey: empty-string ip should map to unknown (currently the key ends with an empty ip)')
  it.todo('RL-X15 rateLimitKey: linkId containing ":" can collide with another (linkId, ip) pair; linkId must be a UUID at the call site')
})

describe('consumeRateLimit (06 3.5, unit with mocked repositories)', () => {
  const ctx = {
    actor: null,
    requestMeta: { ip: '203.0.113.5', userAgent: 'vitest', requestId: 'req-rl' },
    now: new Date('2026-10-08T00:00:00Z'),
    actionName: 'auth.signIn',
  }
  const rule = { name: 'login:ip', key: 'login:ip:203.0.113.5', limit: 5, windowSec: 900 }

  beforeEach(() => {
    vi.mocked(incrementRateLimit).mockReset()
    vi.mocked(recordStandalone).mockReset().mockResolvedValue(undefined)
  })

  it('ok up to the limit, no audit', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue({ count: 5, retryAfter: 100 })
    await expect(consumeRateLimit(rule, ctx)).resolves.toEqual({ ok: true })
    expect(incrementRateLimit).toHaveBeenCalledWith('login:ip:203.0.113.5', 900)
    expect(recordStandalone).not.toHaveBeenCalled()
  })
  it('first excess is rejected and writes one audit row without the key', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue({ count: 6, retryAfter: 120 })
    await expect(consumeRateLimit(rule, ctx)).resolves.toEqual({ ok: false, retryAfterSec: 120 })
    expect(recordStandalone).toHaveBeenCalledTimes(1)
    expect(recordStandalone).toHaveBeenCalledWith(ctx, { action: 'security.rate_limited', metadata: { rule: 'login:ip' } })
    expect(JSON.stringify(vi.mocked(recordStandalone).mock.calls)).not.toContain('203.0.113.5:')
  })
  it('uses the rule auditAction', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue({ count: 6, retryAfter: 1 })
    await consumeRateLimit({ ...rule, auditAction: 'auth.login_rate_limited' }, ctx)
    expect(vi.mocked(recordStandalone).mock.calls[0]?.[1].action).toBe('auth.login_rate_limited')
  })
  it('later excess does not write another audit row', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue({ count: 7, retryAfter: 120 })
    await expect(consumeRateLimit(rule, ctx)).resolves.toMatchObject({ ok: false })
    expect(recordStandalone).not.toHaveBeenCalled()
  })
  it('a failing audit write still yields the rate-limit rejection', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue({ count: 6, retryAfter: 5 })
    vi.mocked(recordStandalone).mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(consumeRateLimit(rule, ctx)).resolves.toEqual({ ok: false, retryAfterSec: 5 })
  })
  it('fail-closed: a DB error becomes INTERNAL with the requestId and no internal detail', async () => {
    vi.mocked(incrementRateLimit).mockRejectedValue(new Error('connection refused postgres://secret@host'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = await consumeRateLimit(rule, ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect(err instanceof AppError && err.shape.code).toBe('INTERNAL')
    expect(JSON.stringify(err instanceof AppError ? err.shape : null)).not.toContain('secret')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret')
  })
})
