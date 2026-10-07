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
