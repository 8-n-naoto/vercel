import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertSafeMetadata } from './audit'
import { record } from './audit'
import * as repo from '@/server/repositories/profiles'
import { changePassword, defaultAccountDeps, getProfile, updateProfile, type AccountDeps } from './account'

vi.mock('@/server/auth/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/server/auth/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }))
vi.mock('@/server/auth/supabase-ephemeral', () => ({ createSupabaseEphemeralClient: vi.fn() }))
vi.mock('@/server/db/client', () => ({ getDb: () => ({ transaction: async (fn: (tx: object) => unknown) => fn({}) }) }))
vi.mock('@/server/repositories/profiles', () => ({
  findProfileView: vi.fn(),
  lockProfileForUpdate: vi.fn(),
  setSessionRevokedAt: vi.fn(),
  updateDisplayName: vi.fn(),
}))
vi.mock('./audit', async (orig) => ({ ...(await orig<typeof import('./audit')>()), record: vi.fn() }))

const ctx: ServiceContext = {
  actor: { userId: 'u1', email: 'u1@example.com', displayName: 'Old', role: 'user' },
  requestMeta: { ip: '203.0.113.5', userAgent: 'vitest', requestId: 'r1' },
  now: new Date('2026-10-08T00:00:00Z'),
  actionName: 'account.changePassword',
}
const row = { id: 'u1', email: 'u1@example.com', displayName: 'Old', role: 'user' as const, createdAt: new Date('2026-01-01T00:00:00Z') }
const input = { currentPassword: 'old-password-123', newPassword: 'new-password-1234' }

function setup(over: { signInFails?: boolean; updateError?: boolean; signOutThrows?: boolean } = {}) {
  const calls: string[] = []
  const ephemeral = {
    signInWithPassword: vi.fn(async () => {
      calls.push('verify')
      return over.signInFails ? { data: { user: null }, error: { name: 'AuthApiError' } } : { data: { user: { id: 'u1' } }, error: null }
    }),
    signOut: vi.fn(async () => {
      calls.push('ephemeral.signOut')
      return { error: null }
    }),
  }
  const admin = {
    updateUserById: vi.fn(async () => {
      calls.push('updateUserById')
      return { error: over.updateError ? { name: 'AuthApiError' } : null }
    }),
  }
  const server = {
    signOut: vi.fn(async () => {
      calls.push('server.signOut')
      if (over.signOutThrows) throw new Error('network')
      return { error: null }
    }),
  }
  const deps = {
    createEphemeral: vi.fn(() => ({ auth: ephemeral })),
    createAdmin: vi.fn(() => ({ auth: { admin } })),
    createSupabase: vi.fn(async () => ({ auth: server })),
    updateProfileTx: vi.fn(async (_c: ServiceContext, _u: string, name: string) => ({ ...row, displayName: name })),
    revokeAndAuditTx: vi.fn(async () => void calls.push('revoke+audit')),
    findProfileView: vi.fn(async () => row as typeof row | undefined),
    logWarn: vi.fn(),
  } satisfies Record<keyof AccountDeps, unknown>
  // The mocked clients only implement what the service calls.
  return { deps: deps as unknown as AccountDeps & typeof deps, ephemeral, admin, server, calls }
}

describe('changePassword (06 4.6)', () => {
  it('runs verify -> updateUserById -> revoke+audit -> signOut in order, verifying with the actor email', async () => {
    const { deps, ephemeral, admin, server, calls } = setup()
    await changePassword(ctx, input, deps)
    expect(calls).toEqual(['verify', 'ephemeral.signOut', 'updateUserById', 'revoke+audit', 'server.signOut'])
    expect(ephemeral.signInWithPassword).toHaveBeenCalledWith({ email: 'u1@example.com', password: input.currentPassword })
    expect(ephemeral.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(admin.updateUserById).toHaveBeenCalledWith('u1', { password: input.newPassword })
    expect(server.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('wrong current password: fieldErrors.currentPassword, admin API and DB untouched', async () => {
    const { deps, admin } = setup({ signInFails: true })
    const err = await changePassword(ctx, input, deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    const shape = (err as AppError).shape
    expect(shape.code).toBe('VALIDATION_FAILED')
    expect(shape.fieldErrors).toEqual({ currentPassword: ['現在のパスワードが違います'] })
    expect(admin.updateUserById).not.toHaveBeenCalled()
    expect(deps.revokeAndAuditTx).not.toHaveBeenCalled()
  })
  it('updateUserById failure: no revoke, no audit, error propagates', async () => {
    const { deps } = setup({ updateError: true })
    await expect(changePassword(ctx, input, deps)).rejects.toBeDefined()
    expect(deps.revokeAndAuditTx).not.toHaveBeenCalled()
  })
  it('a failing server signOut is logged and ignored', async () => {
    const { deps } = setup({ signOutThrows: true })
    await expect(changePassword(ctx, input, deps)).resolves.toBeUndefined()
    expect(deps.logWarn).toHaveBeenCalledWith('account.signout_failed', ctx, expect.any(Error))
  })
  it('audit metadata of account.password_changed is empty and carries no password', () => {
    expect(() => assertSafeMetadata('account.password_changed', {})).not.toThrow()
    expect(() => assertSafeMetadata('account.password_changed', { password: 'x' })).toThrow()
  })
})

describe('updateProfile (06 4.5) / getProfile (9.19)', () => {
  it('returns a ProfileView for the actor with ISO createdAt', async () => {
    const { deps } = setup()
    const v = await updateProfile(ctx, { displayName: 'New' }, deps)
    expect(deps.updateProfileTx).toHaveBeenCalledWith(ctx, 'u1', 'New')
    expect(v).toEqual({ id: 'u1', email: 'u1@example.com', displayName: 'New', role: 'user', createdAt: '2026-01-01T00:00:00.000Z' })
  })
  it('profile_updated metadata (before/after displayName) passes the audit guard', () => {
    expect(() => assertSafeMetadata('account.profile_updated', { before: { displayName: 'Old' }, after: { displayName: 'New' } })).not.toThrow()
  })
  it('getProfile reads the actor row; missing row is NOT_FOUND; no actor throws', async () => {
    const { deps } = setup()
    expect((await getProfile(ctx, deps)).id).toBe('u1')
    deps.findProfileView.mockResolvedValueOnce(undefined)
    const err = await getProfile(ctx, deps).catch((e: unknown) => e)
    expect((err as AppError).shape.code).toBe('NOT_FOUND')
    await expect(getProfile({ ...ctx, actor: null }, deps)).rejects.toThrow()
  })
})

describe('default updateProfileTx (06 4.5 transaction)', () => {
  it('same value: no update, no audit, returns the current row', async () => {
    vi.mocked(repo.lockProfileForUpdate).mockResolvedValueOnce(row)
    vi.mocked(record).mockClear()
    vi.mocked(repo.updateDisplayName).mockClear()
    const r = await defaultAccountDeps.updateProfileTx(ctx, 'u1', 'Old')
    expect(r.displayName).toBe('Old')
    expect(repo.updateDisplayName).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })
  it('new value: update + account.profile_updated with before/after in the same transaction', async () => {
    vi.mocked(repo.lockProfileForUpdate).mockResolvedValueOnce(row)
    vi.mocked(record).mockClear()
    const r = await defaultAccountDeps.updateProfileTx(ctx, 'u1', 'New')
    expect(r.displayName).toBe('New')
    expect(repo.updateDisplayName).toHaveBeenCalledWith({}, 'u1', 'New')
    expect(record).toHaveBeenCalledWith({}, ctx, expect.objectContaining({ action: 'account.profile_updated', metadata: { before: { displayName: 'Old' }, after: { displayName: 'New' } } }))
  })
})
