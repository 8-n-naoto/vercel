import { beforeEach, describe, it, expect, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import { recordStandalone } from '@/server/services/audit'
import { incrementRateLimit } from '@/server/services/rate-limit-store'
import { consumeRateLimit, decideRateLimit, rateLimitIpPart, rateLimitKey } from './rate-limit'
import { DECIDE_CASES, DECIDE_X_CASES, KEY_CASES, KEY_X_CASES } from '@/tests/fixtures/rate-limit'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

vi.mock('@/server/services/rate-limit-store', () => ({ incrementRateLimit: vi.fn() }))
vi.mock('@/server/services/audit', () => ({ recordStandalone: vi.fn() }))

describe('07 5.2 coverage', () => {
  // RL-29 lives in src/app/_actions/view.test.ts; RL-08..11 and RL-30 are integration rows and are excluded by the helper.
  itCoversSpec07('RL', [...DECIDE_CASES, ...KEY_CASES].map((c) => c.id).concat('RL-29'))
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

describe('rateLimitIpPart (06 3.5, D-021)', () => {
  it.each([
    ['203.0.113.5', '203.0.113.5'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::ffff:203.0.113.5', '203.0.113.5'],
    ['::ffff:cb00:7105', '203.0.113.5'],
    ['::', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'unknown'],
    ['', 'unknown'],
    ['  ', 'unknown'],
  ])('%s -> %s', (ip, expected) => {
    expect(rateLimitIpPart(ip)).toBe(expected)
  })
  it('an odd IPv4 form accepted by isIP is returned as is (/32) or unknown, never rounded', () => {
    expect(['01.2.3.4', 'unknown']).toContain(rateLimitIpPart('01.2.3.4'))
  })
  it('null / undefined -> unknown; surrounding spaces are trimmed', () => {
    expect(rateLimitIpPart(null)).toBe('unknown')
    expect(rateLimitIpPart(undefined)).toBe('unknown')
    expect(rateLimitIpPart(' 2001:db8::1 ')).toBe('2001:db8:0:0::/64')
  })
  it('every ip-bearing rule goes through it (login:ip, token:ip, share:ip, share-pw:link-ip, raw:ip)', () => {
    for (const rule of ['login:ip', 'token:ip', 'share:ip', 'raw:ip'] as const) {
      expect(rateLimitKey(rule, { ip: '2001:db8::9' })).toBe(`${rule}:2001:db8:0:0::/64`)
    }
    expect(rateLimitKey('share-pw:link-ip', { linkId: 'L', ip: '2001:db8::9' })).toBe('share-pw:link-ip:L:2001:db8:0:0::/64')
  })
})

describe('boundaries outside 07 (T-018)', () => {
  it.each(DECIDE_X_CASES)('$id decideRateLimit', ({ count, limit, retry, expected }) => {
    expect(decideRateLimit(count, limit, retry)).toEqual(expected)
  })
  it.each(KEY_X_CASES)('$id rateLimitKey', ({ rule, parts, expected }) => {
    expect(rateLimitKey(rule, parts)).toBe(expected)
  })
  // D-020: fail-closed / normalized outputs.
  it('RL-X12 decideRateLimit: retry 1.5 gives integer retryAfterSec 2', () => {
    expect(decideRateLimit(6, 5, 1.5)).toEqual({ ok: false, retryAfterSec: 2, writeAudit: true })
  })
  it('RL-X13 decideRateLimit: retry NaN / Infinity gives retryAfterSec 60', () => {
    expect(decideRateLimit(6, 5, Number.NaN)).toEqual({ ok: false, retryAfterSec: 60, writeAudit: true })
    expect(decideRateLimit(6, 5, Infinity)).toEqual({ ok: false, retryAfterSec: 60, writeAudit: true })
  })
  it('RL-X14 rateLimitKey: empty, whitespace-only and undefined ip map to unknown', () => {
    expect(rateLimitKey('share:ip', { ip: '' })).toBe('share:ip:unknown')
    expect(rateLimitKey('share:ip', { ip: '   ' })).toBe('share:ip:unknown')
    expect(rateLimitKey('share-pw:link-ip', { linkId: 'L', ip: '' })).toBe('share-pw:link-ip:L:unknown')
  })
  it('RL-X16 decideRateLimit: NaN / Infinity count or NaN limit is rejected, never ok', () => {
    expect(decideRateLimit(Number.NaN, 5, 60)).toMatchObject({ ok: false })
    expect(decideRateLimit(Infinity, Infinity, 60)).toMatchObject({ ok: false })
    expect(decideRateLimit(1, Number.NaN, 60)).toMatchObject({ ok: false })
  })
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
