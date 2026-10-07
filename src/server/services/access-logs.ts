// Access log reads (06 9.7). The data access is injectable (AccessLogDeps) so unit tests run without a database.
import 'server-only'
import type { AccessLogFilter, AccessLogRow, Page } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { ACCESS_LOG_PAGE_SIZE, parseAccessLogFilter, parsePageNumber } from '@/lib/schemas/access-logs'
import { zUuid } from '@/lib/schemas/common'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFolderRole } from '@/server/authz/folder'
import { getDb } from '@/server/db/client'
import { listAccessLogsForFolder, type AccessLogQuery } from '@/server/repositories/access-logs'

export type AccessLogDbRow = Awaited<ReturnType<typeof listAccessLogsForFolder>>['items'][number]

export interface AccessLogDeps {
  /** assertFolderRole(manage) in a read-only transaction. */
  assertManage: (ctx: ServiceContext, folderId: string) => Promise<unknown>
  listRows: (
    folderId: string,
    q: AccessLogQuery,
    page: { page: number; pageSize: number },
  ) => Promise<{ items: AccessLogDbRow[]; total: number }>
}

export const defaultAccessLogDeps: AccessLogDeps = {
  assertManage: (ctx, folderId) => getDb().transaction((tx) => assertFolderRole(ctx, tx, folderId, 'manage')),
  listRows: (folderId, q, page) => listAccessLogsForFolder(getDb(), folderId, q, page),
}

export const DELETED_USER_NAME = '（削除されたユーザー）'

function viewerOf(r: AccessLogDbRow): AccessLogRow['viewer'] {
  if (r.shareLinkId !== null) {
    return { kind: 'share_link', linkId: r.shareLinkId, label: r.linkLabel ?? '', tokenHint: r.linkHint ?? '' }
  }
  // user_id is set for every non-share_link row (access_logs_via_user_ck); a missing profile is shown as deleted
  return { kind: 'user', userId: r.userId ?? '', displayName: r.userName ?? DELETED_USER_NAME }
}

function toDate(iso: string | undefined): Date | undefined {
  return iso === undefined ? undefined : new Date(iso)
}

/**
 * 06 9.7. Re-normalises the filter (invalid values are dropped) and the page number; the page size is fixed (08 5.5).
 * `delivered` = delivered_at IS NOT NULL AND bytes_sent > 0 (failed deliveries carry bytes_sent = 0; 06 10.1).
 */
async function listForFolder(
  ctx: ServiceContext,
  folderId: string,
  filter: AccessLogFilter,
  page: { page?: number } = {},
  deps: AccessLogDeps = defaultAccessLogDeps,
): Promise<Page<AccessLogRow>> {
  if (!zUuid.safeParse(folderId).success) throw appError('NOT_FOUND', 'common.not_found')
  await deps.assertManage(ctx, folderId)
  const f = parseAccessLogFilter({ ...filter })
  const pageNo = parsePageNumber(page.page)
  const { items, total } = await deps.listRows(
    folderId,
    { fileId: f.fileId, result: f.result, via: f.via, from: toDate(f.from), to: toDate(f.to) },
    { page: pageNo, pageSize: ACCESS_LOG_PAGE_SIZE },
  )
  return {
    items: items.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      file: { id: r.fileId, displayName: r.fileName ?? '' },
      via: r.via,
      purpose: r.purpose,
      result: r.result,
      denyReason: r.denyReason,
      viewer: viewerOf(r),
      delivered: r.deliveredAt !== null && (r.bytesSent ?? 0) > 0,
      ip: r.ip,
      userAgent: r.userAgent,
    })),
    page: pageNo,
    pageSize: ACCESS_LOG_PAGE_SIZE,
    total,
  }
}

export const accessLogService = { listForFolder }
