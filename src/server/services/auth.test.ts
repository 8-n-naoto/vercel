import { describe, expect, it, vi } from 'vitest'
import { AppError, appError } from '@/lib/errors'
import { authSignOutInput } from '@/lib/schemas/auth'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertSafeMetadata } from './audit'
import { emailHash, signIn, signOut, type AuthDeps } from './auth'

vi.mock('@/server/auth/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/server/repositories/profiles', () => ({ findProfileById: vi.fn(), touchLastLogin: vi.fn() }))
vi.mock('./audit', async (orig) => ({ ...(await orig<typeof import('./audit')>()), record: vi.fn(), recordStandalone: vi.fn() }))

const ctx: ServiceContext = {
  actor: null,
  requestMeta: { ip: '203.0.113.5', userAgent: 'vitest', requestId: 'r1' },
  now: new Date('2026-10-08T00:00:00Z'),
  actionName: 'auth.signIn',
}
const input = { email: 'User@Example.com', password: 'correct horse battery', next: null as string | null }

function setup(over: { signIn?: { data: { user: { id: string } | null }; error: unknown }; profile?: { id: string; disabledAt: Date | null } | undefined; signOutError?: unknown } = {}) {
  const calls: string[] = []
  const auth = {
    signInWithPassword: vi.fn(async () => {
      calls.push('signIn')
      return over.signIn ?? { data: { user: { id: 'u1' } }, error: null }
    }),
    signOut: vi.fn(async (): Promise<{ error: Error | null }> => {
      calls.push('supabase.signOut')
      if (over.signOutError) throw over.signOutError
      return { error: null }
    }),
  }
  const deps = {
    createSupabase: vi.fn(async () => ({ auth })),
    findProfileById: vi.fn(async () => ('profile' in over ? over.profile : { id: 'u1', disabledAt: null })),
    completeLogin: vi.fn(async () => void calls.push('completeLogin')),
    recordLoginFailed: vi.fn(async () => void calls.push('audit.failed')),
    recordLogout: vi.fn(async () => void calls.push('audit.logout')),
    logWarn: vi.fn(),
  } satisfies Record<keyof AuthDeps, unknown>
  // The mocked client only implements what the service calls.
  return { auth, deps: deps as unknown as AuthDeps & typeof deps, calls }
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p
  } catch (e) {
    if (e instanceof AppError) return e
    throw e
  }
  throw new Error('expected rejection')
}

describe('signIn (06 4.1)', () => {
  it('success: last_login_at + auth.login in completeLogin, returns /folders when next is null', async () => {
    const { deps, calls } = setup()
    await expect(signIn(ctx, input, deps)).resolves.toBe('/folders')
    expect(deps.completeLogin).toHaveBeenCalledWith(ctx, 'u1')
    expect(deps.recordLoginFailed).not.toHaveBeenCalled()
    expect(calls).toEqual(['signIn', 'completeLogin'])
  })
  it('success: returns next', async () => {
    const { deps } = setup()
    await expect(signIn(ctx, { ...input, next: '/folders/abc' }, deps)).resolves.toBe('/folders/abc')
  })

  const paths = [
    { name: 'wrong credentials', over: { signIn: { data: { user: null }, error: { name: 'AuthApiError' } } }, reason: 'invalid_credentials', signedOut: false },
    { name: 'no profile', over: { profile: undefined }, reason: 'no_profile', signedOut: true },
    { name: 'disabled', over: { profile: { id: 'u1', disabledAt: new Date() } }, reason: 'disabled', signedOut: true },
  ] as const
  it.each(paths)('$name: same error, login_failed reason recorded, no last_login_at', async ({ over, reason, signedOut }) => {
    const { deps, auth } = setup(over)
    const err = await errorOf(signIn(ctx, input, deps))
    expect(err.shape).toEqual(appError('VALIDATION_FAILED', 'auth.invalid_credentials').shape)
    expect(err.shape.fieldErrors).toBeUndefined()
    expect(deps.recordLoginFailed).toHaveBeenCalledWith(ctx, emailHash(input.email), reason)
    expect(deps.completeLogin).not.toHaveBeenCalled()
    expect(auth.signOut).toHaveBeenCalledTimes(signedOut ? 1 : 0)
  })
  it('the local session is dropped before the failure is audited (profile paths)', async () => {
    const { deps, calls } = setup({ profile: undefined })
    await errorOf(signIn(ctx, input, deps))
    expect(calls).toEqual(['signIn', 'supabase.signOut', 'audit.failed'])
  })
  it('a failing Supabase signOut does not change the error', async () => {
    const { deps } = setup({ profile: undefined, signOutError: new Error('network') })
    const err = await errorOf(signIn(ctx, input, deps))
    expect(err.shape).toEqual(appError('VALIDATION_FAILED', 'auth.invalid_credentials').shape)
    expect(deps.logWarn).toHaveBeenCalledWith('auth.signout_failed', ctx, expect.any(Error))
  })
  it('emailHash is sha256 of the lower-cased email and passes the audit guard; no plaintext email or password', () => {
    expect(emailHash('User@Example.com')).toBe(emailHash(' user@example.com '))
    expect(emailHash('a@example.com')).toMatch(/^[0-9a-f]{64}$/)
    const metadata = { emailHash: emailHash(input.email), reason: 'disabled' as const }
    expect(() => assertSafeMetadata('auth.login_failed', metadata)).not.toThrow()
    const text = JSON.stringify(metadata)
    expect(text).not.toContain('example.com')
    expect(text).not.toContain(input.password)
  })
})

describe('signOut (06 4.2)', () => {
  it('audits first, then signs out locally', async () => {
    const { deps, auth, calls } = setup()
    await signOut(ctx, deps)
    expect(calls).toEqual(['audit.logout', 'supabase.signOut'])
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('continues (resolves) and logs auth.signout_failed when Supabase throws or returns an error', async () => {
    const a = setup({ signOutError: new Error('boom') })
    await expect(signOut(ctx, a.deps)).resolves.toBeUndefined()
    expect(a.deps.logWarn).toHaveBeenCalledWith('auth.signout_failed', ctx, expect.any(Error))
    const b = setup()
    b.auth.signOut.mockResolvedValueOnce({ error: new Error('x') })
    await signOut(ctx, b.deps)
    expect(b.deps.logWarn).toHaveBeenCalledTimes(1)
  })
  it('input schema accepts {} and no argument, rejects extra keys', () => {
    expect(authSignOutInput.safeParse({}).success).toBe(true)
    expect(authSignOutInput.safeParse(undefined).success).toBe(true)
    expect(authSignOutInput.safeParse({ a: 1 }).success).toBe(false)
  })
})
