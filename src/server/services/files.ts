// File RSC reads (06 9.4 listInFolder, 9.8 getUploadContext, 9.9 getDetail).
import 'server-only'
import { fileDisplayState } from '@/lib/display-state'
import type { FileDetail, FileDetailResult, FileList, UploadContext } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { zUuid } from '@/lib/schemas/common'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFileRole, assertFolderRole } from '@/server/authz/folder'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import { listActiveFilesForAdmin, listPublicFilesForMember, sumQuotaUsage, type FileRow } from '@/server/repositories/files'
import { findDisplayName } from '@/server/repositories/profiles'

export const FILE_SORTS = ['updated_desc', 'name_asc', 'size_desc'] as const
export type FileSort = (typeof FILE_SORTS)[number]

/** 06 9.4: an invalid or missing value is 'updated_desc'. */
export function parseFileSort(v: string | string[] | undefined): FileSort {
  const s = Array.isArray(v) ? v[0] : v
  return FILE_SORTS.find((x) => x === s) ?? 'updated_desc'
}

export type AdminFileRow = Awaited<ReturnType<typeof listActiveFilesForAdmin>>[number]
export type MemberFileRow = Awaited<ReturnType<typeof listPublicFilesForMember>>[number]

export interface FileReadDeps {
  assertFolder: (ctx: ServiceContext, folderId: string) => Promise<{ access: 'admin' | 'member' }>
  listAdminRows: (folderId: string, sort: FileSort, now: Date) => Promise<AdminFileRow[]>
  listMemberRows: (folderId: string, sort: FileSort, now: Date) => Promise<MemberFileRow[]>
}

export const defaultFileReadDeps: FileReadDeps = {
  assertFolder: (ctx, folderId) => getDb().transaction((tx) => assertFolderRole(ctx, tx, folderId, 'view')),
  listAdminRows: (folderId, sort, now) => listActiveFilesForAdmin(getDb(), folderId, sort, now),
  listMemberRows: (folderId, sort, now) => listPublicFilesForMember(getDb(), folderId, sort, now),
}

/** 06 9.4. pending / deleted files are never listed; members get public files only, without restriction details. */
async function listInFolder(ctx: ServiceContext, folderId: string, sort: FileSort, deps: FileReadDeps = defaultFileReadDeps): Promise<FileList> {
  if (!zUuid.safeParse(folderId).success) throw appError('NOT_FOUND', 'common.not_found')
  const { access } = await deps.assertFolder(ctx, folderId)
  const safeSort = parseFileSort(sort)
  if (access === 'admin') {
    const rows = await deps.listAdminRows(folderId, safeSort, ctx.now)
    return {
      access: 'admin',
      files: rows.map((r) => ({
        id: r.id,
        folderId: r.folderId,
        displayName: r.displayName,
        sizeBytes: r.sizeBytes,
        displayState: fileDisplayState(r, ctx.now),
        viewStartsAt: r.viewStartsAt?.toISOString() ?? null,
        activeShareLinkCount: r.activeShareLinkCount,
        updatedAt: r.updatedAt.toISOString(),
      })),
    }
  }
  const rows = await deps.listMemberRows(folderId, safeSort, ctx.now)
  return {
    access: 'member',
    files: rows.map((r) => ({
      id: r.id,
      folderId: r.folderId,
      displayName: r.displayName,
      sizeBytes: r.sizeBytes,
      updatedAt: r.updatedAt.toISOString(),
    })),
  }
}

/** 06 2 FileDetail from a files row. Dates become ISO strings (06 1.4); activatedAt is set once a file is active. */
export function toFileDetail(file: FileRow, folderName: string, uploader: { id: string; displayName: string }, now: Date): FileDetail {
  return {
    id: file.id,
    folderId: file.folderId,
    folderName,
    displayName: file.displayName,
    originalFilename: file.originalFilename,
    sizeBytes: file.sizeBytes,
    charset: file.charset,
    displayState: fileDisplayState(file, now),
    restrictions: {
      suspended: file.suspended,
      viewStartsAt: file.viewStartsAt?.toISOString() ?? null,
      viewEndsAt: file.viewEndsAt?.toISOString() ?? null,
      expiresAt: file.expiresAt?.toISOString() ?? null,
      downloadAllowed: file.downloadAllowed,
    },
    uploadedBy: uploader,
    activatedAt: (file.activatedAt ?? now).toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  }
}

const MB = 1_048_576

export interface UploadContextDeps {
  /** assertFolderRole(manage) + one usage statement (07 6). */
  load: (ctx: ServiceContext, folderId: string) => Promise<{ folder: { id: string; name: string }; userUsed: number; totalUsed: number }>
  limits: () => { maxFileBytes: number; userLimitBytes: number; totalLimitBytes: number }
}

export const defaultUploadContextDeps: UploadContextDeps = {
  load: (ctx, folderId) =>
    getDb().transaction(async (tx) => {
      if (!ctx.actor) throw appError('UNAUTHENTICATED', 'common.unauthenticated')
      const { folder } = await assertFolderRole(ctx, tx, folderId, 'manage')
      const usage = await sumQuotaUsage(tx, ctx.actor.userId)
      return { folder: { id: folder.id, name: folder.name }, ...usage }
    }),
  limits: () => {
    const c = getConfig()
    return { maxFileBytes: c.MAX_FILE_SIZE_MB * MB, userLimitBytes: c.USER_QUOTA_MB * MB, totalLimitBytes: c.TOTAL_QUOTA_MB * MB }
  },
}

/** 06 9.8. Admin only (a member is FORBIDDEN, a non-member NOT_FOUND via assertFolderRole). */
async function getUploadContext(ctx: ServiceContext, folderId: string, deps: UploadContextDeps = defaultUploadContextDeps): Promise<UploadContext> {
  if (!zUuid.safeParse(folderId).success) throw appError('NOT_FOUND', 'common.not_found')
  const r = await deps.load(ctx, folderId)
  const l = deps.limits()
  return {
    folder: r.folder,
    maxFileSizeBytes: l.maxFileBytes,
    userQuota: { usedBytes: r.userUsed, limitBytes: l.userLimitBytes },
    totalQuota: { usedBytes: r.totalUsed, limitBytes: l.totalLimitBytes },
  }
}

export interface FileDetailDeps {
  /** assertFileRole(view) (a deleted file is absent) + the uploader name for admins (null for members: no lookup). */
  load: (ctx: ServiceContext, fileId: string) => Promise<{ access: 'admin' | 'member'; file: FileRow; folderName: string; uploaderName: string | null }>
}

export const defaultFileDetailDeps: FileDetailDeps = {
  load: (ctx, fileId) =>
    getDb().transaction(async (tx) => {
      const r = await assertFileRole(ctx, tx, fileId, 'view')
      const uploaderName = r.access === 'admin' ? ((await findDisplayName(tx, r.file.uploadedBy)) ?? '') : null
      return { access: r.access, file: r.file, folderName: r.folder.name, uploaderName }
    }),
}

/** 06 9.9. Admin: any active file. Member: public files only, anything else is NOT_FOUND (the state is not revealed). */
async function getDetail(ctx: ServiceContext, fileId: string, deps: FileDetailDeps = defaultFileDetailDeps): Promise<FileDetailResult> {
  if (!zUuid.safeParse(fileId).success) throw appError('NOT_FOUND', 'common.not_found')
  const r = await deps.load(ctx, fileId)
  const f = r.file
  if (f.status !== 'active') throw appError('NOT_FOUND', 'common.not_found') // pending has no detail screen
  if (r.access === 'admin') {
    return { access: 'admin', file: toFileDetail(f, r.folderName, { id: f.uploadedBy, displayName: r.uploaderName ?? '' }, ctx.now) }
  }
  if (fileDisplayState(f, ctx.now) !== 'public') throw appError('NOT_FOUND', 'common.not_found')
  return {
    access: 'member',
    file: {
      id: f.id,
      folderId: f.folderId,
      folderName: r.folderName,
      displayName: f.displayName,
      sizeBytes: f.sizeBytes,
      updatedAt: f.updatedAt.toISOString(),
      downloadAllowed: f.downloadAllowed,
    },
  }
}

export const filesService = { listInFolder, getUploadContext, getDetail }
