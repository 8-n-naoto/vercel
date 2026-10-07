// File edits (06 7.4 update / 7.5 updateRestrictions / 7.6 delete). The data access is injectable (FileEditDeps) so unit tests
// run the procedures without a database; the Storage adapter is a fake in tests. Paths are never logged or put into errors.
import 'server-only'
import type { FileCharset } from '@/lib/domain'
import type { FileDetail, FileRestrictions } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { message } from '@/lib/messages'
import type { FilesUpdateInput, FilesUpdateRestrictionsInput } from '@/lib/schemas/files'
import { toUtcSeconds, validateRestrictions } from '@/lib/schemas/restrictions'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFileRole } from '@/server/authz/folder'
import { getDb } from '@/server/db/client'
import { markFileDeleted, markFilesPurged, updateFileRestrictions, updateFileText, type FileRow } from '@/server/repositories/files'
import { findDisplayName } from '@/server/repositories/profiles'
import { revokeLinksForDeletedFile } from '@/server/repositories/share-links'
import { getObjects, type ObjectsAdapter } from '@/server/storage/objects'
import { record } from './audit'
import { toFileDetail } from './files'

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw appError('UNAUTHENTICATED', 'common.unauthenticated') // callers are authenticated actions
  return ctx.actor
}

type FileText = Partial<{ displayName: string; charset: FileCharset }>
export interface RestrictionValues {
  suspended: boolean
  downloadAllowed: boolean
  viewStartsAt: Date | null
  viewEndsAt: Date | null
  expiresAt: Date | null
}

export interface FileEditTx {
  /** assertFileRole(manage, { lock: 'share', lockFile: true }); a deleted file or a non-member is NOT_FOUND. */
  assertFile: () => Promise<{ file: FileRow; folderName: string }>
  uploaderName: (userId: string) => Promise<string>
  updateText: (fileId: string, v: FileText) => Promise<FileRow>
  updateRestrictions: (fileId: string, v: RestrictionValues) => Promise<FileRow>
  markDeleted: (fileId: string) => Promise<void>
  revokeLinks: (fileId: string) => Promise<number>
  audit: {
    updated: (f: FileRow, before: FileText, after: FileText) => Promise<void>
    restrictionsUpdated: (f: FileRow, before: Partial<FileRestrictions>, after: Partial<FileRestrictions>) => Promise<void>
    deleted: (f: FileRow, revokedLinks: number) => Promise<void>
  }
}

export interface FileEditDeps {
  transaction: <T>(ctx: ServiceContext, fileId: string, fn: (tx: FileEditTx) => Promise<T>) => Promise<T>
  objects: () => ObjectsAdapter
  markPurged: (fileId: string, at: Date) => Promise<void>
  log: (event: string, ctx: ServiceContext, extra?: Record<string, unknown>) => void
}

export const defaultFileEditDeps: FileEditDeps = {
  transaction: (ctx, fileId, fn) =>
    getDb().transaction((tx) => {
      const actor = actorOf(ctx)
      return fn({
        assertFile: async () => {
          const r = await assertFileRole(ctx, tx, fileId, 'manage', { lock: 'share', lockFile: true })
          return { file: r.file, folderName: r.folder.name }
        },
        uploaderName: async (userId) => (await findDisplayName(tx, userId)) ?? '',
        updateText: async (id, v) => {
          const row = await updateFileText(tx, id, v)
          if (!row) throw appError('NOT_FOUND', 'common.not_found')
          return row
        },
        updateRestrictions: async (id, v) => {
          const row = await updateFileRestrictions(tx, id, v)
          if (!row) throw appError('NOT_FOUND', 'common.not_found')
          return row
        },
        markDeleted: (id) => markFileDeleted(tx, id, { by: actor.userId, at: ctx.now, reason: 'user', purgedAt: null }),
        revokeLinks: (id) => revokeLinksForDeletedFile(tx, id, actor.userId, ctx.now),
        audit: {
          updated: (f, before, after) =>
            record(tx, ctx, { action: 'file.updated', target: { type: 'file', id: f.id }, folderId: f.folderId, metadata: { before, after } }),
          restrictionsUpdated: (f, before, after) =>
            record(tx, ctx, {
              action: 'file.restrictions_updated',
              target: { type: 'file', id: f.id },
              folderId: f.folderId,
              metadata: { before, after },
            }),
          deleted: (f, revokedLinks) =>
            record(tx, ctx, {
              action: 'file.deleted',
              target: { type: 'file', id: f.id },
              folderId: f.folderId,
              metadata: { displayName: f.displayName, revokedLinks },
            }),
        },
      })
    }),
  objects: getObjects,
  markPurged: (id, at) => markFilesPurged(getDb(), [id], at),
  // Names only: never a path, a signed URL or an SDK message.
  log: (event, ctx, extra) =>
    console.error(JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestMeta.requestId, ...extra })),
}

/** A pending file has no edit / detail screen: it is NOT_FOUND like a deleted one. */
async function activeFile(tx: FileEditTx) {
  const r = await tx.assertFile()
  if (r.file.status !== 'active') throw appError('NOT_FOUND', 'common.not_found')
  return r
}

async function detailOf(tx: FileEditTx, file: FileRow, folderName: string, ctx: ServiceContext): Promise<FileDetail> {
  const name = await tx.uploaderName(file.uploadedBy)
  return toFileDetail(file, folderName, { id: file.uploadedBy, displayName: name }, ctx.now)
}

/** 06 7.4. Unchanged values return the current detail without a write or an audit row. */
async function update(ctx: ServiceContext, input: FilesUpdateInput, deps: FileEditDeps = defaultFileEditDeps): Promise<FileDetail> {
  actorOf(ctx)
  return deps.transaction(ctx, input.fileId, async (tx) => {
    const { file, folderName } = await activeFile(tx)
    const before: FileText = {}
    const after: FileText = {}
    if (input.displayName !== undefined && input.displayName !== file.displayName) {
      before.displayName = file.displayName
      after.displayName = input.displayName
    }
    if (input.charset !== undefined && input.charset !== file.charset) {
      before.charset = file.charset
      after.charset = input.charset
    }
    if (Object.keys(after).length === 0) return detailOf(tx, file, folderName, ctx)
    const row = await tx.updateText(file.id, after)
    await tx.audit.updated(row, before, after)
    return detailOf(tx, row, folderName, ctx)
  })
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/** 06 7.5. expiresAt in the past is accepted only when it equals the stored value (07 12). */
async function updateRestrictions(
  ctx: ServiceContext,
  input: FilesUpdateRestrictionsInput,
  deps: FileEditDeps = defaultFileEditDeps,
): Promise<FileDetail> {
  actorOf(ctx)
  const next = {
    viewStartsAt: input.viewStartsAt ? toUtcSeconds(input.viewStartsAt) : null,
    viewEndsAt: input.viewEndsAt ? toUtcSeconds(input.viewEndsAt) : null,
    expiresAt: input.expiresAt ? toUtcSeconds(input.expiresAt) : null,
  }
  return deps.transaction(ctx, input.fileId, async (tx) => {
    const { file, folderName } = await activeFile(tx)
    const errors = validateRestrictions(next, { expiresAt: file.expiresAt }, ctx.now)
    const fieldErrors: Record<string, string[]> = {}
    if (errors.viewEndsAt) fieldErrors.viewEndsAt = [message(errors.viewEndsAt)]
    if (errors.expiresAt) fieldErrors.expiresAt = [message(errors.expiresAt)]
    if (Object.keys(fieldErrors).length > 0) throw appError('VALIDATION_FAILED', 'common.validation_failed', { fieldErrors })

    const before: Partial<FileRestrictions> = {}
    const after: Partial<FileRestrictions> = {}
    if (input.suspended !== file.suspended) {
      before.suspended = file.suspended
      after.suspended = input.suspended
    }
    if (input.downloadAllowed !== file.downloadAllowed) {
      before.downloadAllowed = file.downloadAllowed
      after.downloadAllowed = input.downloadAllowed
    }
    for (const k of ['viewStartsAt', 'viewEndsAt', 'expiresAt'] as const) {
      if (next[k]?.getTime() !== file[k]?.getTime()) {
        before[k] = iso(file[k])
        after[k] = iso(next[k])
      }
    }
    if (Object.keys(after).length === 0) return detailOf(tx, file, folderName, ctx)
    const row = await tx.updateRestrictions(file.id, { suspended: input.suspended, downloadAllowed: input.downloadAllowed, ...next })
    await tx.audit.restrictionsUpdated(row, before, after)
    return detailOf(tx, row, folderName, ctx)
  })
}

/** 06 7.6. The object is removed after the commit; a failure leaves purged_at NULL for the daily job (purged: false). */
async function remove(
  ctx: ServiceContext,
  input: { fileId: string },
  deps: FileEditDeps = defaultFileEditDeps,
): Promise<{ revokedLinks: number; purged: boolean }> {
  actorOf(ctx)
  const done = await deps.transaction(ctx, input.fileId, async (tx) => {
    const { file } = await tx.assertFile() // pending and active files are deleted
    await tx.markDeleted(file.id)
    const revokedLinks = await tx.revokeLinks(file.id)
    await tx.audit.deleted(file, revokedLinks)
    return { file, revokedLinks }
  })
  let removed = false
  try {
    removed = (await deps.objects().remove(done.file.storagePath)).failed.length === 0
  } catch {
    removed = false
  }
  if (!removed) {
    deps.log('file.remove_failed', ctx)
    return { revokedLinks: done.revokedLinks, purged: false }
  }
  try {
    await deps.markPurged(done.file.id, ctx.now)
  } catch {
    deps.log('file.mark_purged_failed', ctx) // the daily job retries (purged_at stays NULL)
    return { revokedLinks: done.revokedLinks, purged: false }
  }
  return { revokedLinks: done.revokedLinks, purged: true }
}

export const fileEditsService = { update, updateRestrictions, delete: remove }
