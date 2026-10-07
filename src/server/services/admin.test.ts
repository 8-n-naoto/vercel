import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import type { Actor } from '@/server/authz/session'
import { hashToken } from '@/server/security/tokens'
import { assertSafeMetadata } from './audit'
import { adminService, createInvite, issuePasswordReset, revokeInvite, type AdminDeps, type AdminInviteTxOps } from './admin'

vi.mock('@/server/authz/session', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/server/config', () => ({ getConfig: vi.fn() }))
vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/server/repositories/invites', () => ({
  insertInvite: vi.fn(),
  listSignupInvites: vi.fn(),
  lockInviteById: vi.fn(),
  markInviteRevoked: vi.fn(),
  revokeOpenResetInvitesByUser: vi.fn(),
  revokeOpenSignupInvitesByEmail: vi.fn(),
}))
vi.mock('@/server/repositories/profiles', () => ({ lockProfileStateForShare: vi.fn(), profileEmailExists: vi.fn() }))

const NOW = new Date('2026-10-08T00:00:00Z')
const admin: Actor = { userId: 'admin1', email: 'admin@example.com', displayName: 'Admin', role: 'admin' }
const ctx: ServiceContext = {
  actor: admin,
  requestMeta: { ip: '203.0.113.5', userAgent: 'vitest', requestId: 'r1' },
  now: NOW,
  actionName: 'admin.createInvite',
}
const TOKEN = 'T'.repeat(43)

type LockedInvite = NonNullable<Awaited<ReturnType<AdminInviteTxOps['lockInvite']>>>
const signupRow: LockedInvite = { id: 'inv1', purpose: 'signup', email: 'new@example.com', usedAt: null, revokedAt: null }

interface Setup {
  emailExists?: boolean
  invite?: LockedInvite | undefined
  profile?: { id: string; email: string; disabledAt: Date | null } | undefined
}

function setup(over: Setup = {}) {
  const calls: string[] = []
  const ops: AdminInviteTxOps = {
    profileEmailExists: vi.fn(async () => over.emailExists ?? false),
    revokeOpenSignup: vi.fn(async () => void calls.push('revokeOpenSignup')),
    insertInvite: vi.fn<AdminInviteTxOps['insertInvite']>(async () => {
      calls.push('insert')
      return 'new-invite'
    }),
    auditCreated: vi.fn(async () => void calls.push('audit.created')),
    lockInvite: vi.fn(async () => ('invite' in over ? over.invite : signupRow)),
    markRevoked: vi.fn(async () => void calls.push('markRevoked')),
    auditRevoked: vi.fn(async () => void calls.push('audit.revoked')),
    lockProfileShared: vi.fn(async () => ('profile' in over ? over.profile : { id: 'u1', email: 'u1@example.com', disabledAt: null })),
    revokeOpenReset: vi.fn(async () => void calls.push('revokeOpenReset')),
    auditResetIssued: vi.fn(async () => void calls.push('audit.reset_issued')),
  }
  const rawDeps = {
    requireAdmin: vi.fn<AdminDeps['requireAdmin']>(async () => admin),
    listSignupInvites: vi.fn<AdminDeps['listSignupInvites']>(),
    generateToken: vi.fn<AdminDeps['generateToken']>(() => TOKEN),
    config: vi.fn<AdminDeps['config']>(() => ({ appOrigin: 'https://app.example.test', inviteTtlHours: 72, resetTtlHours: 24 })),
  }
  const deps: AdminDeps = { ...rawDeps, transaction: (_c, fn) => fn(ops) }
  return { deps, rawDeps, ops, calls }
}

describe('admin.createInvite (06 5.1)', () => {
  it('revokes the old open invite, stores only the token hash, audits, and returns the URL', async () => {
    const s = setup()
    const out = await createInvite(ctx, { email: 'new@example.com', role: 'user' }, s.deps)
    expect(s.calls).toEqual(['revokeOpenSignup', 'insert', 'audit.created'])
    expect(out).toEqual({
      inviteId: 'new-invite',
      inviteUrl: `https://app.example.test/invite/${TOKEN}`,
      expiresAt: '2026-10-11T00:00:00.000Z',
    })
    expect(s.ops.revokeOpenSignup).toHaveBeenCalledWith('new@example.com', NOW)
    const inserted = vi.mocked(s.ops.insertInvite).mock.calls[0]?.[0]
    expect(inserted).toEqual({
      purpose: 'signup',
      email: 'new@example.com',
      role: 'user',
      userId: null,
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date('2026-10-11T00:00:00.000Z'),
      createdBy: 'admin1',
    })
    // plaintext token appears neither in the DB payload nor in the audit payload
    expect(JSON.stringify(vi.mocked(s.ops.insertInvite).mock.calls)).not.toContain(TOKEN)
    const audit = vi.mocked(s.ops.auditCreated).mock.calls[0]
    expect(audit).toEqual(['new-invite', { email: 'new@example.com', role: 'user', expiresAt: '2026-10-11T00:00:00.000Z' }])
    expect(JSON.stringify(audit)).not.toContain(TOKEN)
    expect(() => assertSafeMetadata('invite.created', audit?.[1] ?? {})).not.toThrow()
  })

  it('CONFLICT when a profile with the email exists; nothing is revoked or inserted', async () => {
    const s = setup({ emailExists: true })
    const err = await createInvite(ctx, { email: 'new@example.com', role: 'admin' }, s.deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).shape).toMatchObject({ code: 'CONFLICT', message: 'このメールアドレスのユーザーは既に登録されています' })
    expect(s.calls).toEqual([])
  })

  it('propagates a unique violation (23505) for defineAction to map to concurrent_update', async () => {
    const s = setup()
    vi.mocked(s.ops.insertInvite).mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    await expect(createInvite(ctx, { email: 'new@example.com', role: 'user' }, s.deps)).rejects.toMatchObject({ code: '23505' })
  })
})

describe('admin.revokeInvite (06 5.2)', () => {
  it('revokes an open invite and audits with the email only', async () => {
    const s = setup()
    await revokeInvite(ctx, { inviteId: 'inv1' }, s.deps)
    expect(s.calls).toEqual(['markRevoked', 'audit.revoked'])
    expect(s.ops.markRevoked).toHaveBeenCalledWith('inv1', NOW)
    expect(s.ops.auditRevoked).toHaveBeenCalledWith('inv1', 'new@example.com')
  })
  it('also revokes an expired unused invite', async () => {
    const s = setup({ invite: { ...signupRow } })
    await expect(revokeInvite(ctx, { inviteId: 'inv1' }, s.deps)).resolves.toBeUndefined()
    expect(s.ops.markRevoked).toHaveBeenCalled()
  })
  it('CONFLICT for a used invite', async () => {
    const s = setup({ invite: { ...signupRow, usedAt: new Date('2026-10-07T00:00:00Z') } })
    const err = await revokeInvite(ctx, { inviteId: 'inv1' }, s.deps).catch((e: unknown) => e)
    expect((err as AppError).shape.code).toBe('CONFLICT')
    expect(s.calls).toEqual([])
  })
  it('an already revoked invite is a successful no-op without an audit row', async () => {
    const s = setup({ invite: { ...signupRow, revokedAt: new Date('2026-10-07T00:00:00Z') } })
    await expect(revokeInvite(ctx, { inviteId: 'inv1' }, s.deps)).resolves.toBeUndefined()
    expect(s.calls).toEqual([])
  })
  it.each([
    ['missing', undefined],
    ['password_reset row', { ...signupRow, purpose: 'password_reset' as const }],
  ])('NOT_FOUND for a %s', async (_n, invite) => {
    const s = setup({ invite })
    const err = await revokeInvite(ctx, { inviteId: 'inv1' }, s.deps).catch((e: unknown) => e)
    expect((err as AppError).shape.code).toBe('NOT_FOUND')
  })
})

describe('admin.issuePasswordReset (06 5.3)', () => {
  it('locks the profile, revokes the old reset URL, inserts the hash only, audits, and returns the URL', async () => {
    const s = setup()
    const out = await issuePasswordReset({ ...ctx, actionName: 'admin.issuePasswordReset' }, { userId: 'u1' }, s.deps)
    expect(s.calls).toEqual(['revokeOpenReset', 'insert', 'audit.reset_issued'])
    expect(out).toEqual({ resetUrl: `https://app.example.test/reset/${TOKEN}`, expiresAt: '2026-10-09T00:00:00.000Z' })
    expect(vi.mocked(s.ops.insertInvite).mock.calls[0]?.[0]).toEqual({
      purpose: 'password_reset',
      email: 'u1@example.com',
      role: null,
      userId: 'u1',
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date('2026-10-09T00:00:00.000Z'),
      createdBy: 'admin1',
    })
    const audit = vi.mocked(s.ops.auditResetIssued).mock.calls[0]
    expect(audit).toEqual(['u1', { inviteId: 'new-invite', expiresAt: '2026-10-09T00:00:00.000Z' }])
    expect(JSON.stringify([audit, vi.mocked(s.ops.insertInvite).mock.calls])).not.toContain(TOKEN)
    expect(() => assertSafeMetadata('user.password_reset_issued', audit?.[1] ?? {})).not.toThrow()
  })
  it('works for the admin themselves', async () => {
    const s = setup({ profile: { id: 'admin1', email: 'admin@example.com', disabledAt: null } })
    await expect(issuePasswordReset(ctx, { userId: 'admin1' }, s.deps)).resolves.toMatchObject({ expiresAt: '2026-10-09T00:00:00.000Z' })
  })
  it('NOT_FOUND for an unknown user', async () => {
    const s = setup({ profile: undefined })
    const err = await issuePasswordReset(ctx, { userId: 'zz' }, s.deps).catch((e: unknown) => e)
    expect((err as AppError).shape.code).toBe('NOT_FOUND')
  })
  it('CONFLICT (user.disabled_cannot_reset) for a disabled user; nothing is written', async () => {
    const s = setup({ profile: { id: 'u1', email: 'u1@example.com', disabledAt: new Date('2026-10-01T00:00:00Z') } })
    const err = await issuePasswordReset(ctx, { userId: 'u1' }, s.deps).catch((e: unknown) => e)
    expect((err as AppError).shape).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('無効化されたユーザー') })
    expect(s.calls).toEqual([])
  })
})

describe('admin.listInvites (06 9.14)', () => {
  const dbRow = {
    id: 'i1',
    email: 'a@example.com',
    role: 'user' as const,
    expiresAt: new Date('2026-10-10T00:00:00Z'),
    usedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-10-07T00:00:00Z'),
    createdById: 'admin1',
    createdByName: 'Admin',
  }

  it('requires an admin and maps rows with state computed by inviteState', async () => {
    const s = setup()
    s.rawDeps.listSignupInvites.mockResolvedValue({
      items: [
        dbRow,
        { ...dbRow, id: 'i2', expiresAt: new Date('2026-10-07T12:00:00Z') },
        { ...dbRow, id: 'i3', usedAt: new Date('2026-10-07T01:00:00Z'), revokedAt: null },
        { ...dbRow, id: 'i4', revokedAt: new Date('2026-10-07T01:00:00Z') },
      ],
      total: 4,
    })
    const out = await adminService.listInvites(ctx, { state: undefined }, { page: 1, pageSize: 50 }, s.deps)
    expect(s.rawDeps.requireAdmin).toHaveBeenCalledTimes(1)
    expect(out.items.map((i) => [i.id, i.state])).toEqual([
      ['i1', 'open'],
      ['i2', 'expired'],
      ['i3', 'used'],
      ['i4', 'revoked'],
    ])
    expect(out).toMatchObject({ page: 1, pageSize: 50, total: 4 })
    expect(out.items[0]).toMatchObject({ createdBy: { id: 'admin1', displayName: 'Admin' }, expiresAt: '2026-10-10T00:00:00.000Z', usedAt: null })
    expect(s.rawDeps.listSignupInvites).toHaveBeenCalledWith({ state: undefined }, NOW, { page: 1, pageSize: 50 })
  })

  it('does not query when requireAdmin rejects', async () => {
    const s = setup()
    s.rawDeps.requireAdmin.mockRejectedValue(new AppError({ code: 'FORBIDDEN', message: 'x' }))
    await expect(adminService.listInvites(ctx, {}, { page: 1, pageSize: 50 }, s.deps)).rejects.toBeInstanceOf(AppError)
    expect(s.rawDeps.listSignupInvites).not.toHaveBeenCalled()
  })
})
