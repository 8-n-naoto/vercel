// Invite acceptance, password-reset completion and invite inspection (06 4.3 / 4.4 / 9.13). The Supabase clients and the data
// access are injectable so unit tests can run the procedures without a database.
import 'server-only'
import type { UserRole } from '@/lib/domain'
import type { InviteInspect } from '@/lib/dto'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { createSupabaseAdminClient } from '@/server/auth/supabase-admin'
import { createSupabaseServerClient } from '@/server/auth/supabase-server'
import { getDb } from '@/server/db/client'
import {
  findInviteForInspect,
  findResetInviteByTokenHash,
  lockInviteById,
  lockSignupInviteByTokenHash,
  markInviteUsed,
} from '@/server/repositories/invites'
import { insertProfile, lockProfileStateForUpdate, profileEmailExists, setSessionRevokedAt } from '@/server/repositories/profiles'
import { consumeRateLimit, rateLimitKey } from '@/server/security/rate-limit'
import { hashToken, isTokenFormat } from '@/server/security/tokens'
import { record } from './audit'

export interface InviteLockRow {
  id: string
  email: string
  role: UserRole | null
  userId: string | null
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
}

/** The operations of one business transaction: a fake in unit tests, the repositories plus the audit writer in production. */
export interface InviteTxOps {
  lockSignupInvite: (tokenHash: string) => Promise<InviteLockRow | undefined>
  profileEmailExists: (email: string) => Promise<boolean>
  insertProfile: (v: { id: string; email: string; displayName: string; role: UserRole }) => Promise<void>
  markUsed: (inviteId: string, at: Date) => Promise<void>
  auditAccepted: (inviteId: string, userId: string, role: UserRole) => Promise<void>
  findResetInvite: (tokenHash: string) => Promise<{ id: string; userId: string | null } | undefined>
  lockProfileState: (userId: string) => Promise<{ id: string; disabledAt: Date | null } | undefined>
  lockInvite: (inviteId: string) => Promise<InviteLockRow | undefined>
  revokeSessions: (userId: string, at: Date) => Promise<void>
  auditResetCompleted: (inviteId: string, userId: string) => Promise<void>
}

/** The subset of the Supabase Auth API that this service calls (narrow on purpose, so unit tests can fake it without casts). */
interface AuthErrorLike {
  code?: string | undefined
  status?: number | undefined
  message?: string | undefined
  name?: string | undefined
}
export interface AdminAuthApi {
  createUser: (a: { email: string; password: string; email_confirm: boolean }) => Promise<{ data: { user: { id: string } | null }; error: AuthErrorLike | null }>
  deleteUser: (id: string) => Promise<{ error: AuthErrorLike | null }>
  updateUserById: (id: string, a: { password: string }) => Promise<{ error: AuthErrorLike | null }>
}
export interface SignInApi {
  signInWithPassword: (c: { email: string; password: string }) => Promise<{ error: AuthErrorLike | null }>
}

export interface InviteDeps {
  createAdmin: () => AdminAuthApi
  createSupabase: () => Promise<SignInApi>
  transaction: <T>(ctx: ServiceContext, fn: (ops: InviteTxOps) => Promise<T>) => Promise<T>
  findInspectRow: (
    tokenHash: string,
    purpose: 'signup' | 'password_reset',
  ) => Promise<{ email: string; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null; userDisabledAt: Date | null } | undefined>
  consumeTokenIp: (ctx: ServiceContext) => Promise<{ ok: true } | { ok: false; retryAfterSec: number }>
  log: (event: string, ctx: ServiceContext, extra?: Record<string, unknown>) => void
}

export const defaultInviteDeps: InviteDeps = {
  createAdmin: () => {
    const a = createSupabaseAdminClient().auth.admin
    return { createUser: (x) => a.createUser(x), deleteUser: (id) => a.deleteUser(id), updateUserById: (id, x) => a.updateUserById(id, x) }
  },
  createSupabase: async () => {
    const c = await createSupabaseServerClient()
    return { signInWithPassword: (x) => c.auth.signInWithPassword(x) }
  },
  transaction: (ctx, fn) =>
    getDb().transaction((tx) =>
      fn({
        lockSignupInvite: (h) => lockSignupInviteByTokenHash(tx, h),
        profileEmailExists: (e) => profileEmailExists(tx, e),
        insertProfile: (v) => insertProfile(tx, v),
        markUsed: (id, at) => markInviteUsed(tx, id, at),
        auditAccepted: (inviteId, userId, role) =>
          // The new user is the actor of the row (06 3.6).
          record(tx, ctx, { action: 'invite.accepted', target: { type: 'invite', id: inviteId }, actorOverride: userId, metadata: { userId, role } }),
        findResetInvite: (h) => findResetInviteByTokenHash(tx, h),
        lockProfileState: (id) => lockProfileStateForUpdate(tx, id),
        lockInvite: (id) => lockInviteById(tx, id),
        revokeSessions: (id, at) => setSessionRevokedAt(tx, id, at),
        auditResetCompleted: (inviteId, userId) =>
          record(tx, ctx, { action: 'user.password_reset_completed', target: { type: 'user', id: userId }, metadata: { inviteId } }),
      }),
    ),
  findInspectRow: findInviteForInspect,
  consumeTokenIp: (ctx) =>
    consumeRateLimit({ name: 'token:ip', key: rateLimitKey('token:ip', { ip: ctx.requestMeta.ip }), limit: 10, windowSec: 900 }, ctx),
  // userId / requestId / error names only: never a token, a password or an Auth message.
  log: (event, ctx, extra) => console.error(JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestMeta.requestId, ...extra })),
}

function isUsable(r: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }, now: Date): boolean {
  return r.usedAt === null && r.revokedAt === null && r.expiresAt.getTime() > now.getTime()
}

// supabase-js reports a duplicate e-mail as code 'email_exists' (or 'user_already_exists') with status 422.
function isAlreadyExists(e: AuthErrorLike): boolean {
  if (e.code === 'email_exists' || e.code === 'user_already_exists') return true
  return e.status === 422 && /already|registered|exists/i.test(e.message ?? '')
}

/** 06 9.13. The response shape never depends on whether the token exists: every failure is `{ valid: false }`. */
async function inspect(
  ctx: ServiceContext,
  token: string,
  purpose: 'signup' | 'password_reset',
  deps: InviteDeps = defaultInviteDeps,
): Promise<InviteInspect> {
  const limited = await deps.consumeTokenIp(ctx)
  if (!limited.ok) throw appError('RATE_LIMITED', 'common.rate_limited', { retryAfterSec: limited.retryAfterSec })
  if (!isTokenFormat(token)) return { valid: false }
  const row = await deps.findInspectRow(hashToken(token), purpose)
  if (!row || !isUsable(row, ctx.now)) return { valid: false }
  if (purpose === 'password_reset') return row.userDisabledAt !== null ? { valid: false } : { valid: true, email: null }
  return { valid: true, email: row.email }
}

/** 06 4.3. Returns the path to redirect to once the transaction and the automatic sign-in are done. */
export async function accept(
  ctx: ServiceContext,
  input: { token: string; displayName: string; password: string },
  deps: InviteDeps = defaultInviteDeps,
): Promise<'/folders' | '/login'> {
  const admin = deps.createAdmin()
  let email = ''
  let createdUserId: string | null = null
  try {
    await deps.transaction(ctx, async (ops) => {
      // 1. lock and state check
      const invite = await ops.lockSignupInvite(hashToken(input.token))
      if (!invite || invite.role === null || !isUsable(invite, ctx.now)) throw appError('NOT_FOUND', 'invite.invalid')
      email = invite.email
      // 2. already registered
      if (await ops.profileEmailExists(invite.email)) throw appError('CONFLICT', 'invite.already_registered')
      // 3. Auth user. An Auth user without a profile is an orphan: report CONFLICT and leave the evidence in the log.
      const { data, error } = await admin.createUser({ email: invite.email, password: input.password, email_confirm: true })
      if (error || !data.user) {
        if (error && isAlreadyExists(error)) {
          deps.log('invite.auth_user_exists', ctx)
          throw appError('CONFLICT', 'invite.already_registered')
        }
        throw error ?? new Error('createUser returned no user')
      }
      const userId = data.user.id
      createdUserId = userId
      // 4-6. profile, used_at, audit
      await ops.insertProfile({ id: userId, email: invite.email, displayName: input.displayName, role: invite.role })
      await ops.markUsed(invite.id, ctx.now)
      await ops.auditAccepted(invite.id, userId, invite.role)
    })
  } catch (e) {
    // 7. compensation: steps 4-6 or the commit failed after the Auth user was created
    const orphan: string | null = createdUserId
    if (orphan !== null) {
      try {
        const { error } = await admin.deleteUser(orphan)
        if (error) throw error
      } catch {
        deps.log('invite.compensation_failed', ctx, { userId: orphan })
        throw appError('INTERNAL', 'common.internal', { requestId: ctx.requestMeta.requestId, params: { requestId: ctx.requestMeta.requestId } })
      }
    }
    throw e
  }

  // 8. automatic sign-in; a failure only sends the user to the login screen
  try {
    const supabase = await deps.createSupabase()
    const { error } = await supabase.signInWithPassword({ email, password: input.password })
    return error ? '/login' : '/folders'
  } catch (e) {
    deps.log('invite.auto_signin_failed', ctx, { error: e instanceof Error ? e.name : 'unknown' })
    return '/login'
  }
}

/** 06 4.4. The caller redirects to /login?reset=1. Lock order is profiles then invites (06 1.6). */
export async function completePasswordReset(
  ctx: ServiceContext,
  input: { token: string; password: string },
  deps: InviteDeps = defaultInviteDeps,
): Promise<void> {
  const invalid = () => appError('NOT_FOUND', 'reset.invalid')
  const admin = deps.createAdmin()
  await deps.transaction(ctx, async (ops) => {
    // 1. find without a lock
    const found = await ops.findResetInvite(hashToken(input.token))
    if (!found || found.userId === null) throw invalid()
    const userId = found.userId
    // 2. lock the profile; a disabled user cannot reset
    const profile = await ops.lockProfileState(userId)
    if (!profile || profile.disabledAt !== null) throw invalid()
    // 3. lock the invite and check the state again
    const invite = await ops.lockInvite(found.id)
    if (!invite || invite.userId !== userId || !isUsable(invite, ctx.now)) throw invalid()
    // 4. new password
    const { error } = await admin.updateUserById(userId, { password: input.password })
    if (error) throw error
    // 5-6. revoke sessions, mark used, audit (the actor stays null: the caller is not signed in)
    await ops.revokeSessions(userId, ctx.now)
    await ops.markUsed(found.id, ctx.now)
    await ops.auditResetCompleted(found.id, userId)
  })
}

export const invitesService = { inspect }
