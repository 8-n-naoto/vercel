// File RSC reads (06 9.4). Only listInFolder exists so far; the other file reads arrive with WP-4.x.
import 'server-only'
import { fileDisplayState } from '@/lib/display-state'
import type { FileDetail, FileDetailResult, FileList, UploadContext } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { zUuid } from '@/lib/schemas/common'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFolderRole } from '@/server/authz/folder'
import { getDb } from '@/server/db/client'
import { listActiveFilesForAdmin, listPublicFilesForMember, type FileRow } from '@/server/repositories/files'

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

/** STUB: WP-4.2 replaces. 06 9.8 files.getUploadContext. */
const getUploadContext: (ctx: ServiceContext, folderId: string) => Promise<UploadContext> = async () => {
  throw appError('NOT_FOUND', 'common.not_found')
}

/** STUB: WP-4.2 replaces. 06 9.9 files.getDetail. */
const getDetail: (ctx: ServiceContext, fileId: string) => Promise<FileDetailResult> = async () => {
  throw appError('NOT_FOUND', 'common.not_found')
}

export const filesService = { listInFolder, getUploadContext, getDetail }
