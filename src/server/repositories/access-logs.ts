import 'server-only'
import { and, count, desc, eq, gte, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { AccessResult, AccessVia } from '@/lib/domain'
import { accessLogs, files, profiles, shareLinks } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import type { Reader } from './reader'
import { notImplemented } from './not-implemented'

export type AccessLogRow = typeof accessLogs.$inferSelect
export type AccessLogInsert = typeof accessLogs.$inferInsert
type Executor = Tx | Db

/** Repository-level filter: from/to are already Dates (the service parses the ISO strings of AccessLogFilter). */
export interface AccessLogQuery {
  fileId?: string
  result?: AccessResult
  via?: AccessVia
  from?: Date
  to?: Date
}

/**
 * 06 9.7: two statements (items, total). Rows of deleted files are kept (LEFT JOIN files; the display name stays on the row).
 * The share link token hash is never selected; only token_hint is.
 */
export async function listAccessLogsForFolder(
  executor: Reader,
  folderId: string,
  q: AccessLogQuery,
  page: { page: number; pageSize: number },
) {
  const a = accessLogs
  const fi = alias(files, 'fi')
  const p = alias(profiles, 'p')
  const sl = alias(shareLinks, 'sl')
  const where = and(
    eq(a.folderId, folderId),
    q.fileId ? eq(a.fileId, q.fileId) : undefined,
    q.result ? eq(a.result, q.result) : undefined,
    q.via ? eq(a.via, q.via) : undefined,
    q.from ? gte(a.occurredAt, q.from) : undefined,
    q.to ? lt(a.occurredAt, q.to) : undefined,
  )
  const items = await executor
    .select({
      id: a.id,
      occurredAt: a.occurredAt,
      fileId: a.fileId,
      fileName: fi.displayName,
      via: a.via,
      purpose: a.purpose,
      result: a.result,
      denyReason: a.denyReason,
      userId: a.userId,
      userName: p.displayName,
      shareLinkId: a.shareLinkId,
      linkLabel: sl.label,
      linkHint: sl.tokenHint,
      deliveredAt: a.deliveredAt,
      bytesSent: a.bytesSent,
      ip: a.ip,
      userAgent: a.userAgent,
    })
    .from(a)
    .leftJoin(fi, eq(fi.id, a.fileId))
    .leftJoin(p, eq(p.id, a.userId))
    .leftJoin(sl, eq(sl.id, a.shareLinkId))
    .where(where)
    .orderBy(desc(a.occurredAt), desc(a.id))
    .limit(page.pageSize)
    .offset((page.page - 1) * page.pageSize)
  const totals = await executor.select({ total: count() }).from(a).where(where)
  return { items, total: totals[0]?.total ?? 0 }
}

export async function findAccessLogByTicketHash(ticketHash: string): Promise<AccessLogRow | undefined> {
  return notImplemented('accessLogs.findAccessLogByTicketHash', [ticketHash])
}

/** Inserts one access log row (denied or granted). The caller sets ticket columns only for granted rows. */
export async function insertAccessLog(executor: Executor, values: AccessLogInsert): Promise<void> {
  await executor.insert(accessLogs).values(values)
}
