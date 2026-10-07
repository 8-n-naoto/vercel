// Last-admin protection and self-change prohibition (07 7). Only the pure part exists here; assertNotLastAdmin (DB) arrives with the admin WP.
import type { UserRole } from '@/lib/domain'

export interface AdminChangeInput {
  actorId: string
  targetId: string
  target: { role: UserRole; disabled: boolean } | null
  op: 'disable' | 'demote'
  activeAdminIds: string[]
}
export type AdminChangeResult = 'ok' | 'self' | 'not_found' | 'last_admin' | 'noop'

export function decideAdminChange(i: AdminChangeInput): AdminChangeResult {
  if (i.targetId === i.actorId) return 'self'
  if (!i.target) return 'not_found'
  if (i.op === 'demote' && i.target.role === 'user') return 'noop'
  if (i.target.role === 'admin' && !i.target.disabled && i.activeAdminIds.length === 1 && i.activeAdminIds[0] === i.targetId) {
    return 'last_admin'
  }
  if (i.op === 'disable' && i.target.disabled) return 'noop'
  return 'ok'
}
