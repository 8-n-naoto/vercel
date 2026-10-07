import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { accessLogs, files, folderMembers, folders, profiles, shareLinks } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'

type Executor = Tx | Db

/**
 * 07 8.1 / 06 10.1 step 5: consume a ticket in one statement. "Unused and within its expiry" becomes "used" atomically, so concurrent
 * requests with the same ticket deliver once. bytes_sent starts as files.size_bytes; a failed delivery resets it to 0 (markNotDelivered).
 * Returns undefined when no row matched (unknown hash, denied row, used, expired, hash already nulled).
 */
export async function consumeTicket(executor: Executor, ticketHash: string) {
  const rows = await executor
    .update(accessLogs)
    .set({
      deliveredAt: sql`now()`,
      bytesSent: sql`(select ${files.sizeBytes} from ${files} where ${files.id} = ${accessLogs.fileId})`,
    })
    .where(
      and(
        eq(accessLogs.ticketHash, ticketHash),
        eq(accessLogs.result, 'granted'),
        isNull(accessLogs.deliveredAt),
        sql`${accessLogs.ticketExpiresAt} > now()`,
      ),
    )
    .returning({
      id: accessLogs.id,
      fileId: accessLogs.fileId,
      folderId: accessLogs.folderId,
      via: accessLogs.via,
      purpose: accessLogs.purpose,
      shareLinkId: accessLogs.shareLinkId,
      userId: accessLogs.userId,
    })
  return rows[0]
}

export type ConsumedTicket = NonNullable<Awaited<ReturnType<typeof consumeTicket>>>

/** D-018 (h): a ticket consumed but not delivered. delivered_at stays (the ticket remains used). Also used for 403 / 404 / 502 of /raw. */
export async function markNotDelivered(executor: Executor, accessLogId: number): Promise<void> {
  await executor.update(accessLogs).set({ bytesSent: 0 }).where(eq(accessLogs.id, accessLogId))
}

/**
 * 06 10.1 step 7: everything evaluateAccess({ stage: 'deliver' }) needs, in one statement. A deleted file or folder is returned (the
 * evaluation answers NOT_FOUND). share_links is joined only for via = share_link and only when it belongs to the file; profiles and
 * folder_members only when the ticket has a user. undefined when the file no longer exists.
 */
export async function loadDeliveryContext(executor: Executor, t: { fileId: string; userId: string | null; shareLinkId: string | null }) {
  const rows = await executor
    .select({
      file: files,
      folderDeletedAt: folders.deletedAt,
      link: {
        id: shareLinks.id,
        revokedAt: shareLinks.revokedAt,
        expiresAt: shareLinks.expiresAt,
        maxViews: shareLinks.maxViews,
        viewCount: shareLinks.viewCount,
        passwordHash: shareLinks.passwordHash,
        downloadAllowed: shareLinks.downloadAllowed,
      },
      viewerId: profiles.id,
      viewerRole: profiles.role,
      viewerDisabledAt: profiles.disabledAt,
      isMember: sql<boolean>`(${folderMembers.userId} is not null)`,
    })
    .from(files)
    .innerJoin(folders, eq(folders.id, files.folderId))
    .leftJoin(shareLinks, t.shareLinkId === null ? sql`false` : and(eq(shareLinks.id, t.shareLinkId), eq(shareLinks.fileId, files.id)))
    .leftJoin(profiles, t.userId === null ? sql`false` : eq(profiles.id, t.userId))
    .leftJoin(folderMembers, t.userId === null ? sql`false` : and(eq(folderMembers.folderId, folders.id), eq(folderMembers.userId, t.userId)))
    .where(eq(files.id, t.fileId))
    .limit(1)
  return rows[0]
}

export type DeliveryContextRow = NonNullable<Awaited<ReturnType<typeof loadDeliveryContext>>>

/** 07 8.3: bytes delivered in the current UTC month. COALESCE keeps it 0 (never NULL) when there are no rows. */
export async function sumMonthlyEgress(executor: Executor): Promise<number> {
  const rows = await executor
    .select({ used: sql<string>`coalesce(sum(${accessLogs.bytesSent}), 0)::bigint` })
    .from(accessLogs)
    .where(sql`${accessLogs.deliveredAt} >= date_trunc('month', now(), 'UTC')`)
  return Number(rows[0]?.used ?? 0)
}
