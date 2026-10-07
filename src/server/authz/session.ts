// Phase 0 stub. Implemented in WP-1.3 (06 3.3, 02 5.1.4).
import 'server-only'
import type { UserRole } from '@/lib/domain'

export interface Actor {
  userId: string
  email: string
  displayName: string
  role: UserRole
}

// Failure is AppError('UNAUTHENTICATED'); requireAdmin adds AppError('FORBIDDEN') for role !== 'admin'.
export const requireUser = async (): Promise<Actor> => {
  throw new Error('requireUser is not implemented (WP-1.3)')
}
export const requireAdmin = async (): Promise<Actor> => {
  throw new Error('requireAdmin is not implemented (WP-1.3)')
}
// Never throws; used by layouts for navigation. Never an authorization basis.
export const getActorOrNull = async (): Promise<Actor | null> => null

// Called by defineAction on UNAUTHENTICATED (06 3.1 step 3). The real one deletes the Supabase auth cookies (WP-1.3).
export const clearSessionCookies = async (): Promise<void> => {}

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
