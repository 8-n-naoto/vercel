// Folder authorization. Only the pure decision exists here; assertFolderRole / assertFileRole / assertShareLinkRole (DB) arrive later (06 3.4).
import type { UserRole } from '@/lib/domain'

export type FolderNeed = 'manage' | 'view'
export interface FolderRow {
  folderDeleted: boolean
  isMember: boolean
}
export type FolderAccessResult = { ok: true; access: 'admin' | 'member' } | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' }

/** Rules of 06 3.4. A non-member gets NOT_FOUND before FORBIDDEN so the folder existence is not revealed. */
export function decideFolderAccess(actor: { role: UserRole }, row: FolderRow | null, need: FolderNeed): FolderAccessResult {
  if (row === null || row.folderDeleted) return { ok: false, code: 'NOT_FOUND' }
  if (actor.role === 'admin') return { ok: true, access: 'admin' }
  if (!row.isMember) return { ok: false, code: 'NOT_FOUND' }
  if (need === 'manage') return { ok: false, code: 'FORBIDDEN' }
  return { ok: true, access: 'member' }
}
