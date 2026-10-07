// Folder procedures (06 6.1 / 6.2 / 6.3) and RSC reads (06 9.2 / 9.3 / 9.16).
// The data access is injectable (FolderDeps) so unit tests run the procedures without a database.
// 06 9.16 names the S12 read admin.listFolders; services/admin.ts belongs to another WP, so it lives here as listFolders (T-034 layout).
import 'server-only'
import type { AdminFolderRow, FolderDetail, FolderSummary } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { message } from '@/lib/messages'
import { zUuid } from '@/lib/schemas/common'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFolderRole, type FolderLock } from '@/server/authz/folder'
import { getDb } from '@/server/db/client'
import {
  insertFolder,
  listAdminFolderRows,
  listVisibleFolderRows,
  softDeleteFolder,
  updateFolderText,
} from '@/server/repositories/folders'
import { lockFolderFilesForDelete, markFilesDeletedByFolder, markFilesPurged } from '@/server/repositories/files'
import { revokeLinksForDeletedFolder } from '@/server/repositories/share-links'
import { getObjects, type ObjectsAdapter } from '@/server/storage/objects'
import { record } from './audit'

const PURGE_CHUNK = 100

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw appError('UNAUTHENTICATED', 'common.unauthenticated') // callers are authenticated actions / pages
  return ctx.actor
}

export interface FolderTx {
  /** assertFolderRole(manage) with the given lock; returns the folder (name and description are the stored values). */
  assertManage: (folderId: string, lock: FolderLock) => Promise<{ id: string; name: string; description: string }>
  insertFolder: (v: { name: string; description: string }) => Promise<string>
  updateFolder: (folderId: string, v: { name: string; description: string }) => Promise<void>
  lockFiles: (folderId: string) => Promise<{ id: string; storagePath: string }[]>
  markFilesDeleted: (ids: string[]) => Promise<void>
  revokeLinks: (fileIds: string[]) => Promise<number>
  softDelete: (folderId: string) => Promise<void>
  auditCreated: (folderId: string, name: string) => Promise<void>
  auditUpdated: (
    folderId: string,
    before: { name: string; description: string },
    after: { name: string; description: string },
  ) => Promise<void>
  auditDeleted: (folderId: string, name: string, deletedFiles: number, revokedLinks: number) => Promise<void>
}

export interface FolderDeps {
  transaction: <T>(ctx: ServiceContext, fn: (tx: FolderTx) => Promise<T>) => Promise<T>
  objects: () => ObjectsAdapter
  markPurged: (fileIds: string[], at: Date) => Promise<void>
  listVisibleRows: (opts: { actorId: string | null; now: Date }) => ReturnType<typeof listVisibleFolderRows>
  listAdminRows: (now: Date) => ReturnType<typeof listAdminFolderRows>
  /** assertFolderRole(view) without a transaction and without a lock (06 9.3). */
  assertView: (ctx: ServiceContext, folderId: string) => Promise<{ folder: { id: string; name: string; description: string; createdAt: Date; updatedAt: Date }; access: 'admin' | 'member' }>
  log: (event: string, ctx: ServiceContext, extra?: Record<string, unknown>) => void
}

export const defaultFolderDeps: FolderDeps = {
  transaction: (ctx, fn) =>
    getDb().transaction((tx) => {
      const actorId = ctx.actor?.userId
      if (!actorId) throw appError('UNAUTHENTICATED', 'common.unauthenticated')
      return fn({
        assertManage: async (folderId, lock) => (await assertFolderRole(ctx, tx, folderId, 'manage', { lock })).folder,
        insertFolder: (v) => insertFolder(tx, { ...v, createdBy: actorId }),
        updateFolder: (id, v) => updateFolderText(tx, id, v),
        lockFiles: (folderId) => lockFolderFilesForDelete(tx, folderId),
        markFilesDeleted: (ids) => markFilesDeletedByFolder(tx, ids, actorId, ctx.now),
        revokeLinks: (ids) => revokeLinksForDeletedFolder(tx, ids, actorId, ctx.now),
        softDelete: (id) => softDeleteFolder(tx, id, actorId, ctx.now),
        auditCreated: (id, name) => record(tx, ctx, { action: 'folder.created', target: { type: 'folder', id }, folderId: id, metadata: { name } }),
        auditUpdated: (id, before, after) =>
          record(tx, ctx, { action: 'folder.updated', target: { type: 'folder', id }, folderId: id, metadata: { before, after } }),
        auditDeleted: (id, name, deletedFiles, revokedLinks) =>
          record(tx, ctx, { action: 'folder.deleted', target: { type: 'folder', id }, folderId: id, metadata: { name, deletedFiles, revokedLinks } }),
      })
    }),
  objects: getObjects,
  markPurged: (ids, at) => markFilesPurged(getDb(), ids, at),
  listVisibleRows: (opts) => listVisibleFolderRows(getDb(), opts),
  listAdminRows: (now) => listAdminFolderRows(getDb(), now),
  assertView: (ctx, folderId) => getDb().transaction((tx) => assertFolderRole(ctx, tx, folderId, 'view')),
  // Names only: never a path list, a folder name or an SDK message.
  log: (event, ctx, extra) => console.error(JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestMeta.requestId, ...extra })),
}

/** 06 6.1. */
async function create(ctx: ServiceContext, input: { name: string; description: string }, deps: FolderDeps = defaultFolderDeps): Promise<{ folderId: string }> {
  return deps.transaction(ctx, async (tx) => {
    const folderId = await tx.insertFolder({ name: input.name, description: input.description })
    await tx.auditCreated(folderId, input.name)
    return { folderId }
  })
}

/** 06 6.2. Unchanged values write nothing (no row update, no audit row). */
async function update(
  ctx: ServiceContext,
  input: { folderId: string; name: string; description: string },
  deps: FolderDeps = defaultFolderDeps,
): Promise<void> {
  await deps.transaction(ctx, async (tx) => {
    const folder = await tx.assertManage(input.folderId, 'update')
    if (folder.name === input.name && folder.description === input.description) return
    await tx.updateFolder(folder.id, { name: input.name, description: input.description })
    await tx.auditUpdated(
      folder.id,
      { name: folder.name, description: folder.description },
      { name: input.name, description: input.description },
    )
  })
}

/** 06 6.3. Objects are removed after the commit; failures are retried by the daily job (purged_at stays NULL). */
async function remove(
  ctx: ServiceContext,
  input: { folderId: string; confirmName: string },
  deps: FolderDeps = defaultFolderDeps,
): Promise<{ deletedFiles: number; revokedLinks: number; purgeFailed: number }> {
  const { deletedFiles, revokedLinks, targets } = await deps.transaction(ctx, async (tx) => {
    const folder = await tx.assertManage(input.folderId, 'update')
    if (input.confirmName !== folder.name) {
      throw appError('VALIDATION_FAILED', 'common.validation_failed', {
        fieldErrors: { confirmName: [message('folder.confirm_name_mismatch')] },
      })
    }
    const rows = await tx.lockFiles(folder.id)
    const ids = rows.map((r) => r.id)
    await tx.markFilesDeleted(ids)
    const revoked = await tx.revokeLinks(ids)
    await tx.softDelete(folder.id)
    await tx.auditDeleted(folder.id, folder.name, rows.length, revoked)
    return { deletedFiles: rows.length, revokedLinks: revoked, targets: rows }
  })

  let purgeFailed = 0
  const objects = deps.objects()
  for (let i = 0; i < targets.length; i += PURGE_CHUNK) {
    const chunk = targets.slice(i, i + PURGE_CHUNK)
    try {
      const r = await objects.removeMany(chunk.map((t) => t.storagePath))
      const removed = new Set(r.removed)
      const okIds = chunk.filter((t) => removed.has(t.storagePath)).map((t) => t.id)
      purgeFailed += chunk.length - okIds.length
      if (okIds.length > 0) await deps.markPurged(okIds, new Date())
    } catch (e) {
      // The DB part is committed; the daily job retries the objects whose purged_at is still NULL.
      purgeFailed += chunk.length
      deps.log('folders.purge_failed', ctx, { error: e instanceof Error ? e.name : 'unknown' })
    }
  }
  return { deletedFiles, revokedLinks, purgeFailed }
}

/** 06 9.2. Empty array when nothing is visible. One statement. */
async function listVisible(ctx: ServiceContext, deps: FolderDeps = defaultFolderDeps): Promise<FolderSummary[]> {
  const actor = actorOf(ctx)
  const rows = await deps.listVisibleRows({ actorId: actor.role === 'admin' ? null : actor.userId, now: ctx.now })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    fileCount: r.fileCount,
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** 06 9.3. NOT_FOUND for a non-member, a deleted folder and an id that is not a uuid. */
async function getDetail(ctx: ServiceContext, folderId: string, deps: FolderDeps = defaultFolderDeps): Promise<FolderDetail> {
  if (!zUuid.safeParse(folderId).success) throw appError('NOT_FOUND', 'common.not_found')
  const { folder, access } = await deps.assertView(ctx, folderId)
  return {
    id: folder.id,
    name: folder.name,
    description: folder.description,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    access,
  }
}

/** 06 9.16 (admin only: the page declares auth: 'admin'; the actor role is checked again here). */
async function listFolders(ctx: ServiceContext, deps: FolderDeps = defaultFolderDeps): Promise<AdminFolderRow[]> {
  const actor = actorOf(ctx)
  if (actor.role !== 'admin') throw appError('FORBIDDEN', 'common.forbidden')
  const rows = await deps.listAdminRows(ctx.now)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: r.memberCount,
    fileCount: r.fileCount,
    usedBytes: r.usedBytes,
    activeShareLinkCount: r.activeShareLinkCount,
    createdBy: { id: r.createdById, displayName: r.createdByName },
    updatedAt: r.updatedAt.toISOString(),
  }))
}

export const foldersService = { listVisible, getDetail, listFolders, create, update, remove }
