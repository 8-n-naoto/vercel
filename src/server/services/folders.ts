/* eslint-disable @typescript-eslint/no-unused-vars -- STUB: WP-3.3 replaces these; the parameters keep the 06 signature */
// Folder RSC reads (06 9.2 / 9.3 / 9.16).
// STUB: WP-3.3 replaces these with real queries. Signatures follow 06; the pages depend on nothing else.
// Note: 06 9.16 names the S12 read admin.listFolders; services/admin.ts is not part of WP-3.4, so it lives here as listFolders for now.
import 'server-only'
import type { AdminFolderRow, FolderDetail, FolderSummary } from '@/lib/dto'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'

/** 06 9.2. Empty array when nothing is visible. */
async function listVisible(_ctx: ServiceContext): Promise<FolderSummary[]> {
  return []
}

/** 06 9.3. NOT_FOUND for a non-member, a deleted folder and an id that is not a uuid. */
async function getDetail(_ctx: ServiceContext, _folderId: string): Promise<FolderDetail> {
  throw appError('NOT_FOUND', 'common.not_found')
}

/** 06 9.16 (admin only). */
async function listFolders(_ctx: ServiceContext): Promise<AdminFolderRow[]> {
  return []
}

export const foldersService = { listVisible, getDetail, listFolders }
