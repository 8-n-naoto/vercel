// Admin procedures for invites and password resets (06 5.1 / 5.2 / 5.3 / 9.14). Data access is injectable for unit tests.
import 'server-only'
import type { InviteState, UserRole } from '@/lib/domain'
import { inviteState } from '@/lib/display-state'
import type { InviteRow, Page } from '@/lib/dto'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { requireAdmin, type Actor } from '@/server/authz/session'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import {
  insertInvite,
  listSignupInvites,
  lockInviteById,
  markInviteRevoked,
  revokeOpenResetInvitesByUser,
  revokeOpenSignupInvitesByEmail,
} from '@/server/repositories/invites'
import { lockProfileStateForShare, profileEmailExists } from '@/server/repositories/profiles'
import { generateToken, hashToken } from '@/server/security/tokens'
import { record } from './audit'

interface LockedInvite {
  id: string
  purpose: 'signup' | 'password_reset'
  email: string
  usedAt: Date | null
  revokedAt: Date | null
}

export interface AdminInviteTxOps {
  profileEmailExists: (email: string) => Promise<boolean>
  revokeOpenSignup: (email: string, at: Date) => Promise<void>
  /** Stores only the token hash. */
  insertInvite: (v: {
    purpose: 'signup' | 'password_reset'
    email: string
    role: UserRole | null
    userId: string | null
    tokenHash: string
    expiresAt: Date
    createdBy: string
  }) => Promise<string>
  auditCreated: (inviteId: string, v: { email: string; role: UserRole; expiresAt: string }) => Promise<void>
  lockInvite: (id: string) => Promise<LockedInvite | undefined>
  markRevoked: (id: string, at: Date) => Promise<void>
  auditRevoked: (inviteId: string, email: string) => Promise<void>
  lockProfileShared: (userId: string) => Promise<{ id: string; email: string; disabledAt: Date | null } | undefined>
  revokeOpenReset: (userId: string, at: Date) => Promise<void>
  auditResetIssued: (userId: string, v: { inviteId: string; expiresAt: string }) => Promise<void>
}

export interface AdminDeps {
  transaction: <T>(ctx: ServiceContext, fn: (ops: AdminInviteTxOps) => Promise<T>) => Promise<T>
  requireAdmin: () => Promise<Actor>
  listSignupInvites: typeof listSignupInvites
  generateToken: () => string
  config: () => { appOrigin: string; inviteTtlHours: number; resetTtlHours: number }
}

export const defaultAdminDeps: AdminDeps = {
  transaction: (ctx, fn) =>
    getDb().transaction((tx) =>
      fn({
        profileEmailExists: (e) => profileEmailExists(tx, e),
        revokeOpenSignup: (e, at) => revokeOpenSignupInvitesByEmail(tx, e, at),
        insertInvite: (v) => insertInvite(tx, v),
        auditCreated: (id, metadata) => record(tx, ctx, { action: 'invite.created', target: { type: 'invite', id }, metadata }),
        lockInvite: (id) => lockInviteById(tx, id),
        markRevoked: (id, at) => markInviteRevoked(tx, id, at),
        auditRevoked: (id, email) => record(tx, ctx, { action: 'invite.revoked', target: { type: 'invite', id }, metadata: { email } }),
        lockProfileShared: (id) => lockProfileStateForShare(tx, id),
        revokeOpenReset: (id, at) => revokeOpenResetInvitesByUser(tx, id, at),
        auditResetIssued: (userId, metadata) =>
          record(tx, ctx, { action: 'user.password_reset_issued', target: { type: 'user', id: userId }, metadata }),
      }),
    ),
  requireAdmin,
  listSignupInvites,
  generateToken,
  config: () => {
    const c = getConfig()
    return { appOrigin: c.APP_ORIGIN, inviteTtlHours: c.INVITE_TTL_HOURS, resetTtlHours: c.RESET_TTL_HOURS }
  },
}

// defineAction sets ctx.actor for auth 'admin'; a null here is a wiring bug, not a user error.
function actorOf(ctx: ServiceContext): Actor {
  if (!ctx.actor) throw new Error('admin service requires an authenticated actor')
  return ctx.actor
}

const HOUR_MS = 3_600_000

/** 06 5.1. The returned URL is the only place where the plaintext token leaves this function. */
export async function createInvite(
  ctx: ServiceContext,
  input: { email: string; role: UserRole },
  deps: AdminDeps = defaultAdminDeps,
): Promise<{ inviteId: string; inviteUrl: string; expiresAt: string }> {
  const actor = actorOf(ctx)
  const cfg = deps.config()
  const token = deps.generateToken()
  const expiresAt = new Date(ctx.now.getTime() + cfg.inviteTtlHours * HOUR_MS)
  const inviteId = await deps.transaction(ctx, async (ops) => {
    if (await ops.profileEmailExists(input.email)) throw appError('CONFLICT', 'invite.email_registered')
    await ops.revokeOpenSignup(input.email, ctx.now)
    const id = await ops.insertInvite({
      purpose: 'signup',
      email: input.email,
      role: input.role,
      userId: null,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: actor.userId,
    })
    await ops.auditCreated(id, { email: input.email, role: input.role, expiresAt: expiresAt.toISOString() })
    return id
  })
  return { inviteId, inviteUrl: `${cfg.appOrigin}/invite/${token}`, expiresAt: expiresAt.toISOString() }
}

/** 06 5.2. Already revoked is a successful no-op without an audit row. */
export async function revokeInvite(ctx: ServiceContext, input: { inviteId: string }, deps: AdminDeps = defaultAdminDeps): Promise<void> {
  actorOf(ctx)
  await deps.transaction(ctx, async (ops) => {
    const row = await ops.lockInvite(input.inviteId)
    if (!row || row.purpose !== 'signup') throw appError('NOT_FOUND', 'common.not_found')
    if (row.usedAt !== null) throw appError('CONFLICT', 'invite.already_used')
    if (row.revokedAt !== null) return
    await ops.markRevoked(row.id, ctx.now)
    await ops.auditRevoked(row.id, row.email)
  })
}

/** 06 5.3. Lock order profiles then invites. */
export async function issuePasswordReset(
  ctx: ServiceContext,
  input: { userId: string },
  deps: AdminDeps = defaultAdminDeps,
): Promise<{ resetUrl: string; expiresAt: string }> {
  const actor = actorOf(ctx)
  const cfg = deps.config()
  const token = deps.generateToken()
  const expiresAt = new Date(ctx.now.getTime() + cfg.resetTtlHours * HOUR_MS)
  await deps.transaction(ctx, async (ops) => {
    const profile = await ops.lockProfileShared(input.userId)
    if (!profile) throw appError('NOT_FOUND', 'common.not_found')
    if (profile.disabledAt !== null) throw appError('CONFLICT', 'user.disabled_cannot_reset')
    await ops.revokeOpenReset(profile.id, ctx.now)
    const inviteId = await ops.insertInvite({
      purpose: 'password_reset',
      email: profile.email,
      role: null,
      userId: profile.id,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: actor.userId,
    })
    await ops.auditResetIssued(profile.id, { inviteId, expiresAt: expiresAt.toISOString() })
  })
  return { resetUrl: `${cfg.appOrigin}/reset/${token}`, expiresAt: expiresAt.toISOString() }
}

/** 06 9.14. `state` is computed in the application with the same rule as the SQL conditions (07 11.3). */
async function listInvites(
  ctx: ServiceContext,
  filter: { state?: InviteState },
  page: { page: number; pageSize: number },
  deps: AdminDeps = defaultAdminDeps,
): Promise<Page<InviteRow>> {
  await deps.requireAdmin()
  const { items, total } = await deps.listSignupInvites(filter, ctx.now, page)
  return {
    items: items.map((r) => ({
      id: r.id,
      email: r.email,
      // signup rows always carry a role (invites_purpose_fields_ck)
      role: r.role ?? 'user',
      state: inviteState(r, ctx.now),
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      createdBy: { id: r.createdById, displayName: r.createdByName },
      createdAt: r.createdAt.toISOString(),
    })),
    page: page.page,
    pageSize: page.pageSize,
    total,
  }
}

export const adminService = { listInvites, createInvite, revokeInvite, issuePasswordReset }
