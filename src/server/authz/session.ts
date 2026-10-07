// requireUser / requireAdmin / getActorOrNull (06 3.3, 9.1; 02 5.1.4). The decision itself is decideSession below.
import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { appError } from '@/lib/errors'
import type { UserRole } from '@/lib/domain'
import { loadSessionFacts } from '@/server/auth/session-lookup'
import { authCookieBaseName, cookieEnv, enforceCookieOptions, isAuthCookieName } from '@/server/auth/supabase-server'
import { getConfig } from '@/server/config'

export interface Actor {
  userId: string
  email: string
  displayName: string
  role: UserRole
}

// One lookup per request (React.cache). Resolves to null when the session is not valid; rejects on infrastructure errors.
const resolveActor = cache(async (): Promise<Actor | null> => {
  const facts = await loadSessionFacts()
  const verdict = decideSession({
    sub: facts.sub,
    profile: facts.profile,
    authTimeSec: facts.authTimeSec,
    nowMs: Date.now(),
    maxAgeDays: getConfig().SESSION_MAX_AGE_DAYS,
  })
  if (verdict !== 'ok' || facts.profile === null) return null
  const p = facts.profile
  return { userId: p.id, email: p.email, displayName: p.displayName, role: p.role }
})

// Failure is AppError('UNAUTHENTICATED'); requireAdmin adds AppError('FORBIDDEN') for role !== 'admin'.
export const requireUser = async (): Promise<Actor> => {
  const actor = await resolveActor()
  if (actor === null) throw appError('UNAUTHENTICATED', 'common.unauthenticated')
  return actor
}
export const requireAdmin = async (): Promise<Actor> => {
  const actor = await requireUser()
  if (actor.role !== 'admin') throw appError('FORBIDDEN', 'common.forbidden')
  return actor
}
// Never throws (06 9.1); used by layouts for navigation. Never an authorization basis.
export const getActorOrNull = async (): Promise<Actor | null> => {
  try {
    return await resolveActor()
  } catch (e) {
    console.error(
      JSON.stringify({ ts: new Date().toISOString(), event: 'session.lookup_failed', error: e instanceof Error ? e.name : 'unknown' }),
    )
    return null
  }
}

// Called by defineAction on UNAUTHENTICATED (06 3.1 step 3): expires the Supabase auth cookies (base name, chunks, PKCE verifier).
// Never throws: where cookies cannot be written (Server Components) there is nothing to clear.
export const clearSessionCookies = async (): Promise<void> => {
  try {
    const store = await cookies()
    const base = authCookieBaseName()
    const env = cookieEnv()
    for (const { name } of store.getAll()) {
      if (isAuthCookieName(name, base)) store.set(name, '', enforceCookieOptions({ maxAge: 0 }, env))
    }
  } catch {
    // cookies are read-only here
  }
}

export interface SessionInput {
  sub: string | null
  profile: { disabledAt: Date | null; sessionRevokedAt: Date | null } | null
  authTimeSec: number | null
  nowMs: number
  maxAgeDays: number
}

/** Pure part of requireUser (07 13.2). A session whose auth time is unknown is never trusted. */
export function decideSession(i: SessionInput): 'ok' | 'UNAUTHENTICATED' {
  if (i.sub === null) return 'UNAUTHENTICATED'
  if (i.profile === null || i.profile.disabledAt !== null) return 'UNAUTHENTICATED'
  if (i.authTimeSec === null) return 'UNAUTHENTICATED'
  const authMs = i.authTimeSec * 1000
  if (i.profile.sessionRevokedAt !== null && authMs < i.profile.sessionRevokedAt.getTime()) return 'UNAUTHENTICATED'
  if (i.nowMs - authMs > i.maxAgeDays * 86_400_000) return 'UNAUTHENTICATED'
  return 'ok'
}
