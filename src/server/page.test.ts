import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appError } from '@/lib/errors'
import { pageContext, runPage, runPublicPage } from '@/server/page'
import * as session from '@/server/authz/session'

vi.mock('@/server/security/request-meta', () => ({
  getRequestMeta: async () => ({ ip: null, userAgent: null, requestId: 'req-test-3' }),
}))
vi.mock('@/server/authz/session', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  clearSessionCookies: vi.fn(async () => {}),
}))

const actor = { userId: 'u1', email: 'a@example.com', displayName: 'A', role: 'user' as const }
const opts = { route: '/folders/[folderId]', path: '/folders/abc?x=1', auth: 'user' as const }

beforeEach(() => {
  vi.mocked(session.requireUser).mockReset().mockResolvedValue(actor)
  vi.mocked(session.requireAdmin).mockReset().mockResolvedValue({ ...actor, role: 'admin' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('pageContext / runPage / runPublicPage (06 9.0)', () => {
  it("sets actionName to 'page:<route>' and the actor for user pages; public pages have no actor", async () => {
    const ctx = await pageContext(opts)
    expect(ctx).toMatchObject({ actionName: 'page:/folders/[folderId]', actor })
    const pub = await pageContext({ route: '/login', path: '/login', auth: 'public' })
    expect(pub.actor).toBeNull()
    expect(session.requireUser).toHaveBeenCalledTimes(1)
  })

  it('UNAUTHENTICATED in pageContext -> redirect to /login?next=<encoded path>', async () => {
    vi.mocked(session.requireUser).mockRejectedValue(appError('UNAUTHENTICATED', 'common.unauthenticated'))
    await expect(pageContext(opts)).rejects.toMatchObject({ digest: expect.stringContaining('/login?next=%2Ffolders%2Fabc%3Fx%3D1') })
  })

  it('FORBIDDEN (a non-admin on an admin page) -> notFound()', async () => {
    vi.mocked(session.requireAdmin).mockRejectedValue(appError('FORBIDDEN', 'common.forbidden'))
    await expect(pageContext({ ...opts, auth: 'admin' })).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404') })
  })

  it('runPage: NOT_FOUND -> notFound(); UNAUTHENTICATED -> redirect with the remembered path', async () => {
    const ctx = await pageContext(opts)
    await expect(runPage(ctx, async () => { throw appError('NOT_FOUND', 'common.not_found') })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    })
    await expect(runPage(ctx, async () => { throw appError('UNAUTHENTICATED', 'common.unauthenticated') })).rejects.toMatchObject({
      digest: expect.stringContaining('/login?next='),
    })
  })

  it('runPage: other errors (including RATE_LIMITED) are logged as page.failed and rethrown', async () => {
    const ctx = await pageContext(opts)
    const boom = new Error('boom')
    await expect(runPage(ctx, async () => { throw boom })).rejects.toBe(boom)
    const rl = appError('RATE_LIMITED', 'common.rate_limited', { retryAfterSec: 5 })
    await expect(runPage(ctx, async () => { throw rl })).rejects.toBe(rl)
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0]))).toMatchObject({
      event: 'page.failed',
      route: 'page:/folders/[folderId]',
      requestId: 'req-test-3',
    })
  })

  it('runPage returns the value on success', async () => {
    const ctx = await pageContext(opts)
    expect(await runPage(ctx, async () => 42)).toBe(42)
  })

  it('runPublicPage: success -> { ok: true, data }; RATE_LIMITED -> { ok: false, rateLimited }; NOT_FOUND -> notFound()', async () => {
    const ctx = await pageContext({ route: '/s/[token]', path: '/s/t', auth: 'public' })
    expect(await runPublicPage(ctx, async () => 'v')).toEqual({ ok: true, data: 'v' })
    expect(
      await runPublicPage(ctx, async () => { throw appError('RATE_LIMITED', 'common.rate_limited', { retryAfterSec: 30 }) }),
    ).toEqual({ ok: false, rateLimited: { retryAfterSec: 30 } })
    await expect(runPublicPage(ctx, async () => { throw appError('NOT_FOUND', 'common.not_found') })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    })
  })
})
