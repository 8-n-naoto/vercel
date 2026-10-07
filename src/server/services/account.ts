// Account procedures (06 4.5 / 4.6 / 9.19). Supabase clients and data access are injectable so unit tests can mock them.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProfileView } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { message } from '@/lib/messages'
import type { ServiceContext } from '@/server/actions/define-action'
import type { Actor } from '@/server/authz/session'
import { createSupabaseAdminClient } from '@/server/auth/supabase-admin'
import { createSupabaseEphemeralClient } from '@/server/auth/supabase-ephemeral'
import { createSupabaseServerClient } from '@/server/auth/supabase-server'
import { getDb } from '@/server/db/client'
import { findProfileView, lockProfileForUpdate, setSessionRevokedAt, updateDisplayName } from '@/server/repositories/profiles'
import { record } from './audit'

interface ProfileRowView {
  id: string
  email: string
  displayName: string
  role: ProfileView['role']
  createdAt: Date
}

export interface AccountDeps {
  createEphemeral: () => Pick<SupabaseClient, 'auth'>
  createAdmin: () => Pick<SupabaseClient, 'auth'>
  createSupabase: () => Promise<Pick<SupabaseClient, 'auth'>>
  /** 4.5: lock, compare, update and audit in one transaction. Returns the resulting row. */
  updateProfileTx: (ctx: ServiceContext, userId: string, displayName: string) => Promise<ProfileRowView>
  /** 4.6 step 3: session_revoked_at and the audit row in one transaction. */
  revokeAndAuditTx: (ctx: ServiceContext, userId: string) => Promise<void>
  findProfileView: (id: string) => Promise<ProfileRowView | undefined>
  logWarn: (event: string, ctx: ServiceContext, error: unknown) => void
}

export const defaultAccountDeps: AccountDeps = {
  createEphemeral: createSupabaseEphemeralClient,
  createAdmin: createSupabaseAdminClient,
  createSupabase: createSupabaseServerClient,
  updateProfileTx: (ctx, userId, displayName) =>
    getDb().transaction(async (tx) => {
      const row = await lockProfileForUpdate(tx, userId)
      if (!row) throw appError('NOT_FOUND', 'common.not_found')
      if (row.displayName === displayName) return row // unchanged: no write, no audit
      await updateDisplayName(tx, userId, displayName)
      await record(tx, ctx, {
        action: 'account.profile_updated',
        target: { type: 'user', id: userId },
        metadata: { before: { displayName: row.displayName }, after: { displayName } },
      })
      return { ...row, displayName }
    }),
  revokeAndAuditTx: (ctx, userId) =>
    getDb().transaction(async (tx) => {
      await setSessionRevokedAt(tx, userId, ctx.now)
      await record(tx, ctx, { action: 'account.password_changed', target: { type: 'user', id: userId }, metadata: {} })
    }),
  findProfileView,
  // Names only: no message, no cookie, no token.
  logWarn: (event, ctx, error) =>
    console.error(
      JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestMeta.requestId, error: error instanceof Error ? error.name : 'unknown' }),
    ),
}

// defineAction sets ctx.actor for auth 'user'; a null here is a wiring bug, not a user error.
function actorOf(ctx: ServiceContext): Actor {
  if (!ctx.actor) throw new Error('account service requires an authenticated actor')
  return ctx.actor
}

function toView(r: ProfileRowView): ProfileView {
  return { id: r.id, email: r.email, displayName: r.displayName, role: r.role, createdAt: r.createdAt.toISOString() }
}

export async function updateProfile(ctx: ServiceContext, input: { displayName: string }, deps: AccountDeps = defaultAccountDeps): Promise<ProfileView> {
  const actor = actorOf(ctx)
  return toView(await deps.updateProfileTx(ctx, actor.userId, input.displayName))
}

export async function changePassword(
  ctx: ServiceContext,
  input: { currentPassword: string; newPassword: string },
  deps: AccountDeps = defaultAccountDeps,
): Promise<void> {
  const actor = actorOf(ctx)

  // 1. verify the current password with a client that has no cookies
  const ephemeral = deps.createEphemeral()
  const { data, error } = await ephemeral.auth.signInWithPassword({ email: actor.email, password: input.currentPassword })
  if (error || !data?.user) {
    throw appError('VALIDATION_FAILED', 'account.current_password_invalid', {
      fieldErrors: { currentPassword: [message('account.current_password_invalid')] },
    })
  }
  try {
    await ephemeral.auth.signOut({ scope: 'local' })
  } catch (e) {
    deps.logWarn('account.ephemeral_signout_failed', ctx, e)
  }

  // 2. set the new password
  const { error: updateError } = await deps.createAdmin().auth.admin.updateUserById(actor.userId, { password: input.newPassword })
  if (updateError) throw updateError

  // 3. revoke existing sessions + audit
  await deps.revokeAndAuditTx(ctx, actor.userId)

  // 4. drop this session (failure is logged and ignored: session_revoked_at already invalidates it)
  try {
    const supabase = await deps.createSupabase()
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) deps.logWarn('account.signout_failed', ctx, signOutError)
  } catch (e) {
    deps.logWarn('account.signout_failed', ctx, e)
  }
}

export async function getProfile(ctx: ServiceContext, deps: AccountDeps = defaultAccountDeps): Promise<ProfileView> {
  const actor = actorOf(ctx)
  const row = await deps.findProfileView(actor.userId)
  if (!row) throw appError('NOT_FOUND', 'common.not_found')
  return toView(row)
}
