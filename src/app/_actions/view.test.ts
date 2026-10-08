// RL-29 (07 5.2): view.openAsMember is limited by mutation:user and then ticket:user (30 per 60 s), Q-28 / D-022.
// RL-32: view.requestMemberDownload is limited by mutation:user and then download:user (20 per 60 s), Q-33 / D-023.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as session from '@/server/authz/session'
import * as rateLimit from '@/server/security/rate-limit'
import { viewService } from '@/server/services/view'
import { viewOpenAsMember, viewRequestMemberDownload } from './view'

vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-view-1' }),
}))
vi.mock('@/server/authz/session', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  clearSessionCookies: vi.fn(async () => {}),
}))
vi.mock('@/server/security/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/rate-limit')>()),
  consumeRateLimit: vi.fn(),
}))
vi.mock('@/server/services/view', () => ({
  viewService: { openAsMember: vi.fn(), requestMemberDownload: vi.fn() },
}))

const actor = { userId: 'u1', email: 'a@example.com', displayName: 'A', role: 'user' as const }
const input = { fileId: '11111111-1111-4111-8111-111111111111' }

beforeEach(() => {
  vi.mocked(session.requireUser).mockReset().mockResolvedValue(actor)
  vi.mocked(rateLimit.consumeRateLimit).mockReset()
  vi.mocked(viewService.openAsMember).mockReset().mockResolvedValue({} as never)
  vi.mocked(viewService.requestMemberDownload).mockReset().mockResolvedValue({} as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('view.openAsMember rate limit (RL-29)', () => {
  it('evaluates mutation:user then ticket:user 30 / 60 s; the 31st call is RATE_LIMITED without running the handler', async () => {
    const counts = new Map<string, number>()
    vi.mocked(rateLimit.consumeRateLimit).mockImplementation(async (rule) => {
      const n = (counts.get(rule.key) ?? 0) + 1
      counts.set(rule.key, n)
      return n <= rule.limit ? { ok: true } : { ok: false, retryAfterSec: 12 }
    })
    for (let i = 1; i <= 30; i++) {
      const r = await viewOpenAsMember(input)
      expect(r.ok, `call ${i}`).toBe(true)
    }
    expect(viewService.openAsMember).toHaveBeenCalledTimes(30)
    const first = vi.mocked(rateLimit.consumeRateLimit).mock.calls.slice(0, 2).map((c) => c[0])
    expect(first.map((r) => r.name)).toEqual(['mutation:user', 'ticket:user'])
    expect(first[1]).toMatchObject({ key: 'ticket:user:u1', limit: 30, windowSec: 60 })
    expect(first[1]).not.toHaveProperty('auditAction')

    const r31 = await viewOpenAsMember(input)
    expect(r31).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
    expect(viewService.openAsMember).toHaveBeenCalledTimes(30)
  })
})

describe('view.requestMemberDownload rate limit (RL-32)', () => {
  it('evaluates mutation:user then download:user 20 / 60 s; the 21st call is RATE_LIMITED without running the handler', async () => {
    const counts = new Map<string, number>()
    vi.mocked(rateLimit.consumeRateLimit).mockImplementation(async (rule) => {
      const n = (counts.get(rule.key) ?? 0) + 1
      counts.set(rule.key, n)
      return n <= rule.limit ? { ok: true } : { ok: false, retryAfterSec: 12 }
    })
    for (let i = 1; i <= 20; i++) {
      const r = await viewRequestMemberDownload(input)
      expect(r.ok, `call ${i}`).toBe(true)
    }
    expect(viewService.requestMemberDownload).toHaveBeenCalledTimes(20)
    const first = vi.mocked(rateLimit.consumeRateLimit).mock.calls.slice(0, 2).map((c) => c[0])
    expect(first.map((r) => r.name)).toEqual(['mutation:user', 'download:user'])
    expect(first[1]).toMatchObject({ key: 'download:user:u1', limit: 20, windowSec: 60 })
    expect(first[1]).not.toHaveProperty('auditAction')

    const r21 = await viewRequestMemberDownload(input)
    expect(r21).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
    if (!r21.ok) expect(r21.error.retryAfterSec).toBeGreaterThan(0)
    expect(viewService.requestMemberDownload).toHaveBeenCalledTimes(20)
  })

  it('does not share a counter with ticket:user', async () => {
    const counts = new Map<string, number>()
    vi.mocked(rateLimit.consumeRateLimit).mockImplementation(async (rule) => {
      counts.set(rule.key, (counts.get(rule.key) ?? 0) + 1)
      return { ok: true }
    })
    await viewOpenAsMember(input)
    await viewRequestMemberDownload(input)
    expect(counts.get('ticket:user:u1')).toBe(1)
    expect(counts.get('download:user:u1')).toBe(1)
  })
})
