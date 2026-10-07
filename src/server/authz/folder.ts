// Folder authorization (06 3.4): the pure decision plus assertFolderRole / assertFileRole / assertShareLinkRole.
import 'server-only'
import type { UserRole } from '@/lib/domain'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
/* eslint-disable no-restricted-imports -- 02 2.5: authz sits beside repositories in the dependency order (app -> services -> authz -> repositories -> db); the lint rule only models services. */
import type { Tx } from '@/server/repositories/audit-logs'
import { findFileWithFolderAndMembership } from '@/server/repositories/files'
import { findFolderWithMembership, type FolderLockMode, type FolderRow } from '@/server/repositories/folders'
import { findShareLinkWithFileAndFolder } from '@/server/repositories/share-links'
import type { FileRow } from '@/server/repositories/files'
import type { ShareLinkRow } from '@/server/repositories/share-links'
/* eslint-enable no-restricted-imports */

export type FolderNeed = 'manage' | 'view'
export interface FolderAccessRow {
  folderDeleted: boolean
  isMember: boolean
}
export type FolderAccessResult = { ok: true; access: 'admin' | 'member' } | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' }

/** Rules of 06 3.4. A non-member gets NOT_FOUND before FORBIDDEN so the folder existence is not revealed. */
export function decideFolderAccess(actor: { role: UserRole }, row: FolderAccessRow | null, need: FolderNeed): FolderAccessResult {
  if (row === null || row.folderDeleted) return { ok: false, code: 'NOT_FOUND' }
  if (actor.role === 'admin') return { ok: true, access: 'admin' }
  if (!row.isMember) return { ok: false, code: 'NOT_FOUND' }
  if (need === 'manage') return { ok: false, code: 'FORBIDDEN' }
  return { ok: true, access: 'member' }
}

export type FolderLock = FolderLockMode
type Access = 'admin' | 'member'

function actorOf(ctx: ServiceContext) {
  // Every caller is an authenticated action; a missing actor is a programming error, not a user error.
  if (!ctx.actor) throw appError('INTERNAL', 'common.internal', { requestId: ctx.requestMeta.requestId, params: { requestId: ctx.requestMeta.requestId } })
  return ctx.actor
}

function deny(code: 'NOT_FOUND' | 'FORBIDDEN'): never {
  throw code === 'NOT_FOUND' ? appError('NOT_FOUND', 'common.not_found') : appError('FORBIDDEN', 'common.forbidden')
}

/** Resolves the folder and the membership in one statement, then decides with decideFolderAccess. */
export async function assertFolderRole(
  ctx: ServiceContext,
  tx: Tx,
  folderId: string,
  need: FolderNeed,
  opts: { lock?: FolderLock } = {},
): Promise<{ folder: FolderRow; access: Access }> {
  const actor = actorOf(ctx)
  const found = await findFolderWithMembership(tx, folderId, actor.userId, opts.lock ?? 'none')
  const row = found ? { folderDeleted: found.folder.deletedAt !== null, isMember: found.isMember } : null
  const r = decideFolderAccess(actor, row, need)
  if (!r.ok || !found) return deny(r.ok ? 'NOT_FOUND' : r.code)
  return { folder: found.folder, access: r.access }
}

/** A file whose status is 'deleted' is absent (filtered in SQL). Lock order: folders -> files (06 1.6). */
export async function assertFileRole(
  ctx: ServiceContext,
  tx: Tx,
  fileId: string,
  need: FolderNeed,
  opts: { lock?: FolderLock; lockFile?: boolean } = {},
): Promise<{ file: FileRow; folder: FolderRow; access: Access }> {
  const actor = actorOf(ctx)
  const found = await findFileWithFolderAndMembership(tx, fileId, actor.userId, opts.lock ?? 'none', opts.lockFile ?? false)
  const row = found ? { folderDeleted: found.folder.deletedAt !== null, isMember: found.isMember } : null
  const r = decideFolderAccess(actor, row, need)
  if (!r.ok || !found) return deny(r.ok ? 'NOT_FOUND' : r.code)
  return { file: found.file, folder: found.folder, access: r.access }
}

/** need is always 'manage'; a non-admin actor is FORBIDDEN (defensive: callers are auth: 'admin' actions). */
export async function assertShareLinkRole(
  ctx: ServiceContext,
  tx: Tx,
  linkId: string,
  opts: { lockLink?: boolean } = {},
): Promise<{ link: ShareLinkRow; file: FileRow; folder: FolderRow }> {
  const actor = actorOf(ctx)
  if (actor.role !== 'admin') return deny('FORBIDDEN')
  const found = await findShareLinkWithFileAndFolder(tx, linkId, opts.lockLink ?? false)
  if (!found) return deny('NOT_FOUND')
  return found
}
