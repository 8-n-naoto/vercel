// requireUser / requireAdmin / getActorOrNull / clearSessionCookies with the lookup mocked (no DB, no Supabase).
// The SS-01..SS-11 vectors are run through requireUser; decideSession itself is covered in session.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { SessionFacts } from '@/server/auth/session-lookup'
import { SS_CASES } from '@/tests/fixtures/authz'

const loadSessionFacts = vi.fn<() => Promise<SessionFacts>>()
vi.mock('@/server/auth/session-lookup', () => ({ loadSessionFacts: () => loadSessionFacts() }))
const store = { getAll: vi.fn(), set: vi.fn() }
vi.mock('next/headers', () => ({ cookies: async () => store }))

import { clearSessionCookies, getActorOrNull, requireAdmin, requireUser } from './session'

const profile = (over: Partial<NonNullable<SessionFacts['profile']>> = {}): NonNullable<SessionFacts['profile']> => ({
  id: 'u1',
  email: 'u1@example.com',
  displayName: 'User One',
  role: 'user',
  disabledAt: null,
  sessionRevokedAt: null,
  ...over,
})
const nowSec = () => Math.floor(Date.now() / 1000)

beforeEach(() => {
  loadSessionFacts.mockReset()
  store.getAll.mockReset()
  store.set.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('requireUser', () => {
  it('returns the Actor for a valid session', async () => {
    loadSessionFacts.mockResolvedValue({ sub: 'u1', authTimeSec: nowSec(), profile: profile() })
    await expect(requireUser()).resolves.toEqual({ userId: 'u1', email: 'u1@example.com', displayName: 'User One', role: 'user' })
  })

  it.each(SS_CASES)('$id through requireUser', async ({ input, expected }) => {
    vi.setSystemTime(new Date(input.nowMs))
    loadSessionFacts.mockResolvedValue({
      sub: input.sub,
      authTimeSec: input.authTimeSec,
      profile: input.profile === null ? null : profile(input.profile),
    })
    if (expected === 'ok') await expect(requireUser()).resolves.toMatchObject({ userId: 'u1' })
    else await expect(requireUser()).rejects.toMatchObject({ shape: { code: 'UNAUTHENTICATED' } })
  })

  it('a DB failure is not turned into UNAUTHENTICATED (it propagates and defineAction answers INTERNAL)', async () => {
    loadSessionFacts.mockRejectedValue(new Error('connection refused'))
    await expect(requireUser()).rejects.not.toBeInstanceOf(AppError)
  })
})

describe('requireAdmin', () => {
  it('admin -> Actor', async () => {
    loadSessionFacts.mockResolvedValue({ sub: 'a1', authTimeSec: nowSec(), profile: profile({ id: 'a1', role: 'admin' }) })
    await expect(requireAdmin()).resolves.toMatchObject({ userId: 'a1', role: 'admin' })
  })
  it('member -> FORBIDDEN', async () => {
    loadSessionFacts.mockResolvedValue({ sub: 'u1', authTimeSec: nowSec(), profile: profile() })
    await expect(requireAdmin()).rejects.toMatchObject({ shape: { code: 'FORBIDDEN' } })
  })
  it('not signed in -> UNAUTHENTICATED (not FORBIDDEN)', async () => {
    loadSessionFacts.mockResolvedValue({ sub: null, authTimeSec: null, profile: null })
    await expect(requireAdmin()).rejects.toMatchObject({ shape: { code: 'UNAUTHENTICATED' } })
  })
})

describe('getActorOrNull (06 9.1)', () => {
  it('valid session -> Actor; invalid -> null', async () => {
    loadSessionFacts.mockResolvedValueOnce({ sub: 'u1', authTimeSec: nowSec(), profile: profile() })
    await expect(getActorOrNull()).resolves.toMatchObject({ userId: 'u1' })
    loadSessionFacts.mockResolvedValueOnce({ sub: null, authTimeSec: null, profile: null })
    await expect(getActorOrNull()).resolves.toBeNull()
  })
  it('never throws: a lookup failure gives null and logs session.lookup_failed without details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadSessionFacts.mockRejectedValue(new Error('password authentication failed for user postgres'))
    await expect(getActorOrNull()).resolves.toBeNull()
    const line = String(spy.mock.calls[0]?.[0])
    expect(JSON.parse(line)).toMatchObject({ event: 'session.lookup_failed', error: 'Error' })
    expect(line).not.toContain('password authentication')
    spy.mockRestore()
  })
})

describe('clearSessionCookies', () => {
  it('expires the auth cookie, its chunks and the verifier only (HttpOnly, no Domain, Max-Age 0)', async () => {
    store.getAll.mockReturnValue([
      { name: 'sb-testref-auth-token', value: 'x' },
      { name: 'sb-testref-auth-token.0', value: 'x' },
      { name: 'sb-testref-auth-token.1', value: 'x' },
      { name: 'sb-testref-auth-token-code-verifier', value: 'x' },
      { name: 'theme', value: 'dark' },
      { name: 'sb-other-auth-token', value: 'x' },
    ])
    await clearSessionCookies()
    const names = store.set.mock.calls.map((c) => c[0])
    expect(names).toEqual(['sb-testref-auth-token', 'sb-testref-auth-token.0', 'sb-testref-auth-token.1', 'sb-testref-auth-token-code-verifier'])
    for (const c of store.set.mock.calls) {
      expect(c[1]).toBe('')
      expect(c[2]).toMatchObject({ maxAge: 0, httpOnly: true, sameSite: 'lax', path: '/' })
      expect('domain' in (c[2] as object)).toBe(false)
    }
  })
  it('never throws when cookies cannot be written', async () => {
    store.getAll.mockReturnValue([{ name: 'sb-testref-auth-token', value: 'x' }])
    store.set.mockImplementation(() => {
      throw new Error('read-only')
    })
    await expect(clearSessionCookies()).resolves.toBeUndefined()
  })
})
