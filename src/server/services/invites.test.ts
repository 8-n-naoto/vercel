import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { hashToken } from '@/server/security/tokens'
import { accept, completePasswordReset, invitesService, type AdminAuthApi, type InviteDeps, type InviteLockRow, type InviteTxOps, type SignInApi } from './invites'

vi.mock('@/server/auth/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }))
vi.mock('@/server/auth/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/server/repositories/invites', () => ({
  findInviteForInspect: vi.fn(),
  findResetInviteByTokenHash: vi.fn(),
  lockInviteById: vi.fn(),
  lockSignupInviteByTokenHash: vi.fn(),
  markInviteUsed: vi.fn(),
}))
vi.mock('@/server/repositories/profiles', () => ({
  insertProfile: vi.fn(),
  lockProfileStateForUpdate: vi.fn(),
  profileEmailExists: vi.fn(),
  setSessionRevokedAt: vi.fn(),
}))

const NOW = new Date('2026-10-08T00:00:00Z')
const ctx: ServiceContext = {
  actor: null,
  requestMeta: { ip: '203.0.113.5', userAgent: 'vitest', requestId: 'r1' },
  now: NOW,
  actionName: 'invites.accept',
}
const TOKEN = 'A'.repeat(43)
const PASSWORD = 'a-very-long-password-1'

const openInvite: InviteLockRow = {
  id: 'inv1',
  email: 'new@example.com',
  role: 'user',
  userId: null,
  expiresAt: new Date('2026-10-10T00:00:00Z'),
  usedAt: null,
  revokedAt: null,
}

interface Setup {
  invite?: InviteLockRow | undefined
  emailExists?: boolean
  createUserError?: { code?: string; status?: number; message?: string } | null
  insertProfileFails?: boolean
  auditFails?: boolean
  commitFails?: boolean
  deleteUserFails?: boolean
  signInFails?: boolean
  resetFound?: { id: string; userId: string | null } | undefined
  profile?: { id: string; disabledAt: Date | null } | undefined
  resetInvite?: InviteLockRow | undefined
  updateUserError?: boolean
}

function setup(over: Setup = {}) {
  const calls: string[] = []
  const logs: { event: string; extra?: Record<string, unknown> }[] = []
  const admin: AdminAuthApi = {
    createUser: vi.fn<AdminAuthApi['createUser']>(async () => {
      calls.push('createUser')
      if (over.createUserError) return { data: { user: null }, error: over.createUserError }
      return { data: { user: { id: 'new-user' } }, error: null }
    }),
    deleteUser: vi.fn<AdminAuthApi['deleteUser']>(async () => {
      calls.push('deleteUser')
      if (over.deleteUserFails) throw new Error('boom')
      return { error: null }
    }),
    updateUserById: vi.fn<AdminAuthApi['updateUserById']>(async () => {
      calls.push('updateUserById')
      return { error: over.updateUserError ? { name: 'AuthApiError' } : null }
    }),
  }
  const server: SignInApi = {
    signInWithPassword: vi.fn<SignInApi['signInWithPassword']>(async () => {
      calls.push('signIn')
      return { error: over.signInFails ? { name: 'AuthApiError' } : null }
    }),
  }
  const ops: InviteTxOps = {
    lockSignupInvite: vi.fn(async () => ('invite' in over ? over.invite : openInvite)),
    profileEmailExists: vi.fn(async () => over.emailExists ?? false),
    insertProfile: vi.fn(async () => {
      calls.push('insertProfile')
      if (over.insertProfileFails) throw new Error('db')
    }),
    markUsed: vi.fn(async () => void calls.push('markUsed')),
    auditAccepted: vi.fn(async () => {
      calls.push('audit.accepted')
      if (over.auditFails) throw new Error('db')
    }),
    findResetInvite: vi.fn(async () => ('resetFound' in over ? over.resetFound : { id: 'rst1', userId: 'u1' })),
    lockProfileState: vi.fn(async () => ('profile' in over ? over.profile : { id: 'u1', disabledAt: null })),
    lockInvite: vi.fn(async () => ('resetInvite' in over ? over.resetInvite : { ...openInvite, id: 'rst1', userId: 'u1', role: null })),
    revokeSessions: vi.fn(async () => void calls.push('revokeSessions')),
    auditResetCompleted: vi.fn(async () => void calls.push('audit.reset')),
  }
  const rawDeps = {
    createAdmin: vi.fn<InviteDeps['createAdmin']>(() => admin),
    createSupabase: vi.fn<InviteDeps['createSupabase']>(async () => server),
    findInspectRow: vi.fn<InviteDeps['findInspectRow']>(),
    consumeTokenIp: vi.fn<InviteDeps['consumeTokenIp']>(async () => ({ ok: true })),
    log: vi.fn<InviteDeps['log']>((event, _c, extra) => void logs.push({ event, ...(extra ? { extra } : {}) })),
  }
  const deps: InviteDeps = {
    ...rawDeps,
    transaction: async (_c, fn) => {
      const r = await fn(ops)
      if (over.commitFails) throw new Error('commit')
      return r
    },
  }
  return { deps, rawDeps, ops, admin, server, calls, logs }
}

const code = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p
    return undefined
  } catch (e) {
    return e instanceof AppError ? `${e.shape.code}:${e.shape.message}` : `other:${e instanceof Error ? e.message : ''}`
  }
}

describe('invites.accept (06 4.3)', () => {
  const input = { token: TOKEN, displayName: 'New User', password: PASSWORD }

  it('creates the Auth user, the profile, used_at and the audit row, then signs in', async () => {
    const s = setup()
    await expect(accept(ctx, input, s.deps)).resolves.toBe('/folders')
    expect(s.calls).toEqual(['createUser', 'insertProfile', 'markUsed', 'audit.accepted', 'signIn'])
    expect(s.ops.lockSignupInvite).toHaveBeenCalledWith(hashToken(TOKEN))
    expect(s.ops.insertProfile).toHaveBeenCalledWith({ id: 'new-user', email: 'new@example.com', displayName: 'New User', role: 'user' })
    expect(s.ops.markUsed).toHaveBeenCalledWith('inv1', NOW)
    expect(s.ops.auditAccepted).toHaveBeenCalledWith('inv1', 'new-user', 'user')
    expect(s.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('goes to /login when the automatic sign-in fails', async () => {
    const s = setup({ signInFails: true })
    await expect(accept(ctx, input, s.deps)).resolves.toBe('/login')
  })

  it.each([
    ['unknown token', { invite: undefined }],
    ['used (second call)', { invite: { ...openInvite, usedAt: new Date('2026-10-07T00:00:00Z') } }],
    ['revoked', { invite: { ...openInvite, revokedAt: new Date('2026-10-07T00:00:00Z') } }],
    ['expired', { invite: { ...openInvite, expiresAt: new Date('2026-10-07T00:00:00Z') } }],
    ['expires exactly now', { invite: { ...openInvite, expiresAt: NOW } }],
    ['password_reset row (no role)', { invite: { ...openInvite, role: null } }],
  ] satisfies [string, Setup][])('NOT_FOUND for %s, before any Auth call', async (_n, over) => {
    const s = setup(over)
    expect(await code(accept(ctx, input, s.deps))).toMatch(/^NOT_FOUND:/)
    expect(s.admin.createUser).not.toHaveBeenCalled()
  })

  it('CONFLICT when a profile with the email already exists', async () => {
    const s = setup({ emailExists: true })
    expect(await code(accept(ctx, input, s.deps))).toMatch(/^CONFLICT:/)
    expect(s.admin.createUser).not.toHaveBeenCalled()
  })

  it('CONFLICT and the invite.auth_user_exists log when the Auth user already exists (orphan)', async () => {
    const s = setup({ createUserError: { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' } })
    expect(await code(accept(ctx, input, s.deps))).toMatch(/^CONFLICT:/)
    expect(s.logs.map((l) => l.event)).toEqual(['invite.auth_user_exists'])
    expect(s.admin.deleteUser).not.toHaveBeenCalled()
    expect(s.ops.insertProfile).not.toHaveBeenCalled()
  })

  it('other createUser errors are rethrown (INTERNAL by defineAction) without compensation', async () => {
    const s = setup({ createUserError: { code: 'unexpected_failure', status: 500, message: 'x' } })
    expect(await code(accept(ctx, input, s.deps))).toMatch(/^other:/)
    expect(s.admin.deleteUser).not.toHaveBeenCalled()
  })

  it.each([
    ['profile insert', { insertProfileFails: true }],
    ['audit insert', { auditFails: true }],
    ['commit', { commitFails: true }],
  ] satisfies [string, Setup][])('deleteUser compensates a %s failure and the original error is rethrown', async (_n, over) => {
    const s = setup(over)
    expect(await code(accept(ctx, input, s.deps))).toMatch(/^other:/)
    expect(s.admin.deleteUser).toHaveBeenCalledWith('new-user')
    expect(s.calls).not.toContain('signIn')
  })

  it('a failed compensation logs invite.compensation_failed with the userId only and returns INTERNAL', async () => {
    const s = setup({ insertProfileFails: true, deleteUserFails: true })
    expect(await code(accept(ctx, input, s.deps))).toMatch(/^INTERNAL:/)
    expect(s.logs).toEqual([{ event: 'invite.compensation_failed', extra: { userId: 'new-user' } }])
    expect(JSON.stringify(s.logs)).not.toContain(PASSWORD)
    expect(JSON.stringify(s.logs)).not.toContain(TOKEN)
  })
})

describe('passwordReset.complete (06 4.4)', () => {
  const input = { token: TOKEN, password: PASSWORD }

  it('updates the password, revokes sessions, marks the invite used and audits, in the 06 order', async () => {
    const s = setup()
    await completePasswordReset(ctx, input, s.deps)
    expect(s.calls).toEqual(['updateUserById', 'revokeSessions', 'markUsed', 'audit.reset'])
    expect(s.admin.updateUserById).toHaveBeenCalledWith('u1', { password: PASSWORD })
    expect(s.ops.revokeSessions).toHaveBeenCalledWith('u1', NOW)
    expect(s.ops.markUsed).toHaveBeenCalledWith('rst1', NOW)
    expect(s.ops.auditResetCompleted).toHaveBeenCalledWith('rst1', 'u1')
  })

  it('locks the profile before the invite (06 1.6)', async () => {
    const s = setup()
    await completePasswordReset(ctx, input, s.deps)
    const profileOrder = vi.mocked(s.ops.lockProfileState).mock.invocationCallOrder[0] ?? 0
    const inviteOrder = vi.mocked(s.ops.lockInvite).mock.invocationCallOrder[0] ?? 0
    expect(profileOrder).toBeGreaterThan(0)
    expect(profileOrder).toBeLessThan(inviteOrder)
  })

  it.each([
    ['unknown token', { resetFound: undefined }],
    ['profile gone', { profile: undefined }],
    ['disabled user', { profile: { id: 'u1', disabledAt: new Date('2026-10-01T00:00:00Z') } }],
    ['used (second call)', { resetInvite: { ...openInvite, id: 'rst1', userId: 'u1', usedAt: new Date('2026-10-07T00:00:00Z') } }],
    ['revoked', { resetInvite: { ...openInvite, id: 'rst1', userId: 'u1', revokedAt: new Date('2026-10-07T00:00:00Z') } }],
    ['expired', { resetInvite: { ...openInvite, id: 'rst1', userId: 'u1', expiresAt: new Date('2026-10-07T00:00:00Z') } }],
  ] satisfies [string, Setup][])('NOT_FOUND for %s, before any password change', async (_n, over) => {
    const s = setup(over)
    expect(await code(completePasswordReset(ctx, input, s.deps))).toMatch(/^NOT_FOUND:/)
    expect(s.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('does not touch the database after an Auth failure', async () => {
    const s = setup({ updateUserError: true })
    expect(await code(completePasswordReset(ctx, input, s.deps))).toMatch(/^other:|AuthApiError|^other/)
    expect(s.ops.revokeSessions).not.toHaveBeenCalled()
    expect(s.ops.markUsed).not.toHaveBeenCalled()
  })
})

describe('invites.inspect (06 9.13)', () => {
  type Row = NonNullable<Awaited<ReturnType<InviteDeps['findInspectRow']>>>
  const valid: Row = { email: 'new@example.com', expiresAt: new Date('2026-10-10T00:00:00Z'), usedAt: null, revokedAt: null, userDisabledAt: null }

  async function run(row: Row | undefined, purpose: 'signup' | 'password_reset', token = TOKEN) {
    const s = setup()
    s.rawDeps.findInspectRow.mockResolvedValue(row)
    return { s, out: await invitesService.inspect(ctx, token, purpose, s.deps) }
  }

  it('returns the email for a valid signup invite and null for a reset', async () => {
    expect((await run(valid, 'signup')).out).toEqual({ valid: true, email: 'new@example.com' })
    expect((await run(valid, 'password_reset')).out).toEqual({ valid: true, email: null })
  })

  it('every failure has the same shape, `{ valid: false }` only', async () => {
    const past = new Date('2026-10-07T00:00:00Z')
    const outs = [
      (await run(undefined, 'signup')).out,
      (await run({ ...valid, usedAt: past }, 'signup')).out,
      (await run({ ...valid, revokedAt: past }, 'signup')).out,
      (await run({ ...valid, expiresAt: past }, 'signup')).out,
      (await run({ ...valid, userDisabledAt: past }, 'password_reset')).out,
      (await run(valid, 'signup', 'short')).out,
    ]
    for (const o of outs) expect(o).toStrictEqual({ valid: false })
  })

  it('does not query the database for a malformed token, but still consumes the rate limit', async () => {
    const { s } = await run(valid, 'signup', 'short')
    expect(s.rawDeps.consumeTokenIp).toHaveBeenCalledTimes(1)
    expect(s.rawDeps.findInspectRow).not.toHaveBeenCalled()
  })

  it('queries by the hash of the token, never the token itself', async () => {
    const { s } = await run(valid, 'signup')
    expect(s.rawDeps.findInspectRow).toHaveBeenCalledWith(hashToken(TOKEN), 'signup')
  })

  it('throws RATE_LIMITED with retryAfterSec when token:ip is exceeded, before the lookup', async () => {
    const s = setup()
    s.rawDeps.consumeTokenIp.mockResolvedValue({ ok: false, retryAfterSec: 42 })
    const err = await invitesService.inspect(ctx, TOKEN, 'signup', s.deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).shape).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 42 })
    expect(s.rawDeps.findInspectRow).not.toHaveBeenCalled()
  })
})
