// Sign-in / sign-out procedures (06 4.1 / 4.2). The Supabase client and the data access are injectable so unit tests can mock them.
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { createSupabaseServerClient } from '@/server/auth/supabase-server'
import { getDb } from '@/server/db/client'
import { findProfileById, touchLastLogin } from '@/server/repositories/profiles'
import { record, recordStandalone } from './audit'

type LoginFailReason = 'invalid_credentials' | 'disabled' | 'no_profile'

export interface AuthDeps {
  createSupabase: () => Promise<Pick<SupabaseClient, 'auth'>>
  findProfileById: (id: string) => Promise<{ id: string; disabledAt: Date | null } | undefined>
  /** Step 3: last_login_at and the auth.login audit row in one transaction. */
  completeLogin: (ctx: ServiceContext, userId: string) => Promise<void>
  recordLoginFailed: (ctx: ServiceContext, emailHash: string, reason: LoginFailReason) => Promise<void>
  recordLogout: (ctx: ServiceContext) => Promise<void>
  logWarn: (event: string, ctx: ServiceContext, error: unknown) => void
}

export const defaultAuthDeps: AuthDeps = {
  createSupabase: createSupabaseServerClient,
  findProfileById,
  completeLogin: (ctx, userId) =>
    getDb().transaction(async (tx) => {
      await touchLastLogin(tx, userId, ctx.now)
      // The actor is still null in a public Action: the new session's user is the actor of the row.
      await record(tx, ctx, { action: 'auth.login', target: { type: 'user', id: userId }, actorOverride: userId, metadata: {} })
    }),
  recordLoginFailed: (ctx, emailHash, reason) =>
    recordStandalone(ctx, { action: 'auth.login_failed', result: 'failure', metadata: { emailHash, reason } }),
  recordLogout: (ctx) => recordStandalone(ctx, { action: 'auth.logout', metadata: {} }),
  // Names only: no message, no cookie, no token.
  logWarn: (event, ctx, error) =>
    console.error(
      JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestMeta.requestId, error: error instanceof Error ? error.name : 'unknown' }),
    ),
}

/** sha256hex(lower(email)), the same value as the login:email rate limit key (06 3.6). */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex')
}

/** Returns the path to redirect to. All three failure paths throw the same error (no account enumeration, 06 4.1). */
export async function signIn(
  ctx: ServiceContext,
  input: { email: string; password: string; next: string | null },
  deps: AuthDeps = defaultAuthDeps,
): Promise<string> {
  const supabase = await deps.createSupabase()
  const fail = (): never => {
    throw appError('VALIDATION_FAILED', 'auth.invalid_credentials')
  }

  // 1. credentials
  const { data, error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password })
  const user = data?.user
  if (error || !user) {
    await deps.recordLoginFailed(ctx, emailHash(input.email), 'invalid_credentials')
    return fail()
  }

  // 2. profile must exist and be enabled; otherwise drop the session that step 1 just created
  const profile = await deps.findProfileById(user.id)
  if (!profile || profile.disabledAt !== null) {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (e) {
      deps.logWarn('auth.signout_failed', ctx, e)
    }
    await deps.recordLoginFailed(ctx, emailHash(input.email), profile ? 'disabled' : 'no_profile')
    return fail()
  }

  // 3. last_login_at + auth.login
  await deps.completeLogin(ctx, user.id)

  // 4. the caller redirects
  return input.next ?? '/folders'
}

/** Audit first, then the Supabase sign-out (failure is logged and ignored). The caller clears nothing else and redirects to /login. */
export async function signOut(ctx: ServiceContext, deps: AuthDeps = defaultAuthDeps): Promise<void> {
  await deps.recordLogout(ctx)
  try {
    const supabase = await deps.createSupabase()
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) deps.logWarn('auth.signout_failed', ctx, error)
  } catch (e) {
    deps.logWarn('auth.signout_failed', ctx, e)
  }
}
