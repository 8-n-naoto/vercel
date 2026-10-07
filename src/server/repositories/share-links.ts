import 'server-only'
import { and, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { files, folders, shareLinks } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import { notImplemented } from './not-implemented'

export type ShareLinkRow = typeof shareLinks.$inferSelect

export async function findShareLinkByTokenHash(tokenHash: string): Promise<ShareLinkRow | undefined> {
  return notImplemented('shareLinks.findShareLinkByTokenHash', [tokenHash])
}

export async function listShareLinksForFile(fileId: string): Promise<ShareLinkRow[]> {
  return notImplemented('shareLinks.listShareLinksForFile', [fileId])
}

/** 06 3.4 assertShareLinkRole: link + file + folder in one statement; deleted files / folders are treated as absent. */
export async function findShareLinkWithFileAndFolder(tx: Tx | Db, linkId: string, lockLink: boolean) {
  const sl = alias(shareLinks, 'sl') // FOR ... OF needs an unqualified name
  const fi = alias(files, 'fi')
  const f = alias(folders, 'f')
  const q = tx
    .select({ link: sl, file: fi, folder: f })
    .from(sl)
    .innerJoin(fi, eq(fi.id, sl.fileId))
    .innerJoin(f, eq(f.id, fi.folderId))
    .where(and(eq(sl.id, linkId), ne(fi.status, 'deleted'), isNull(f.deletedAt)))
    .limit(1)
  const rows = lockLink ? await q.for('update', { of: sl }) : await q
  return rows[0]
}

/** 06 6.3 step 4: revokes every open link of the files; returns the number of revoked links. */
export async function revokeLinksForDeletedFolder(tx: Tx, fileIds: string[], by: string, at: Date): Promise<number> {
  if (fileIds.length === 0) return 0
  const rows = await tx
    .update(shareLinks)
    .set({ revokedAt: at, revokedBy: by, revokeReason: 'folder_deleted' })
    .where(and(inArray(shareLinks.fileId, fileIds), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id })
  return rows.length
}

/** The share link condition of 06 9.4 (same rule as the active state of 07 11.2). */
export function activeShareLinkSql(now: Date) {
  return and(isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, now), or(isNull(shareLinks.maxViews), lt(shareLinks.viewCount, shareLinks.maxViews)))
}

/** 06 7.6: revokes every open link of one deleted file; returns the number of revoked links. */
export async function revokeLinksForDeletedFile(tx: Tx, fileId: string, by: string, at: Date): Promise<number> {
  const rows = await tx
    .update(shareLinks)
    .set({ revokedAt: at, revokedBy: by, revokeReason: 'file_deleted' })
    .where(and(eq(shareLinks.fileId, fileId), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id })
  return rows.length
}
