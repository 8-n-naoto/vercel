import 'server-only'
import { and, eq, isNull, ne } from 'drizzle-orm'
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
