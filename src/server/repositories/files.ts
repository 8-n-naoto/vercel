import 'server-only'
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, not, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { files, folderMembers, folders, shareLinks } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import type { Reader } from './reader'
import type { FolderLockMode } from './folders'
import { notImplemented } from './not-implemented'
import { activeShareLinkSql } from './share-links'

export type FileRow = typeof files.$inferSelect

export async function findFileById(id: string): Promise<FileRow | undefined> {
  return notImplemented('files.findFileById', [id])
}

export async function listFilesInFolder(folderId: string): Promise<FileRow[]> {
  return notImplemented('files.listFilesInFolder', [folderId])
}

/**
 * 06 3.4 assertFileRole: file + folder + the actor's membership in one statement; a deleted file is treated as absent.
 * Lock order is folders -> files (06 1.6). Drizzle emits a single locking clause, so share(folders) + update(files) is
 * issued as FOR UPDATE OF folders, files (a stronger folder lock; safe for ordering, see 10 implementation record).
 */
export async function findFileWithFolderAndMembership(tx: Tx | Db, fileId: string, actorId: string, lock: FolderLockMode, lockFile: boolean) {
  const fi = alias(files, 'fi') // FOR ... OF needs unqualified names
  const f = alias(folders, 'f')
  const fm = alias(folderMembers, 'fm')
  const q = tx
    .select({ file: fi, folder: f, isMember: sql<boolean>`(${fm.userId} is not null)` })
    .from(fi)
    .innerJoin(f, eq(f.id, fi.folderId))
    .leftJoin(fm, and(eq(fm.folderId, f.id), eq(fm.userId, actorId)))
    .where(and(eq(fi.id, fileId), ne(fi.status, 'deleted')))
    .limit(1)
  const rows = lockFile
    ? await q.for('update', { of: lock === 'none' ? [fi] : [f, fi] })
    : lock === 'none'
      ? await q
      : await q.for(lock, { of: f })
  return rows[0]
}

/** FILE_PUBLIC_SQL (07 11.1): the SQL form of fileDisplayState = 'public'. $now = ctx.now. Uses the unaliased files table. */
export function filePublicSql(now: Date) {
  return and(
    not(files.suspended),
    or(isNull(files.expiresAt), gt(files.expiresAt, now)),
    or(isNull(files.viewStartsAt), lte(files.viewStartsAt, now)),
    or(isNull(files.viewEndsAt), gt(files.viewEndsAt, now)),
  )
}

/** 06 6.3 step 2: pending and active files of the folder, locked in id order. */
export async function lockFolderFilesForDelete(tx: Tx, folderId: string) {
  return tx
    .select({ id: files.id, storagePath: files.storagePath })
    .from(files)
    .where(and(eq(files.folderId, folderId), inArray(files.status, ['pending', 'active'])))
    .orderBy(asc(files.id))
    .for('update')
}

/** 06 6.3 step 3. */
export async function markFilesDeletedByFolder(tx: Tx, ids: string[], by: string, at: Date): Promise<void> {
  if (ids.length === 0) return
  await tx
    .update(files)
    .set({ status: 'deleted', deletedAt: at, deletedBy: by, deleteReason: 'folder_deleted', uploadExpiresAt: null })
    .where(inArray(files.id, ids))
}

/** 06 6.3 step 7: one statement for the files whose objects were removed. */
export async function markFilesPurged(db: Reader, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return
  await db.update(files).set({ purgedAt: at }).where(inArray(files.id, ids))
}

export type FileListSort = 'updated_desc' | 'name_asc' | 'size_desc'

function orderFor(sort: FileListSort) {
  switch (sort) {
    case 'name_asc':
      return [asc(files.displayName), asc(files.id)]
    case 'size_desc':
      return [desc(files.sizeBytes), asc(files.id)]
    default:
      return [desc(files.updatedAt), asc(files.id)]
  }
}

/** 06 9.4 (admin): active files with the number of active share links, in one statement. */
export async function listActiveFilesForAdmin(db: Reader, folderId: string, sort: FileListSort, now: Date) {
  return db
    .select({
      id: files.id,
      folderId: files.folderId,
      displayName: files.displayName,
      sizeBytes: files.sizeBytes,
      suspended: files.suspended,
      viewStartsAt: files.viewStartsAt,
      viewEndsAt: files.viewEndsAt,
      expiresAt: files.expiresAt,
      updatedAt: files.updatedAt,
      activeShareLinkCount: sql<number>`(select count(*)::int from ${shareLinks} where ${shareLinks.fileId} = ${files.id} and ${activeShareLinkSql(now)})`,
    })
    .from(files)
    .where(and(eq(files.folderId, folderId), eq(files.status, 'active')))
    .orderBy(...orderFor(sort))
}

/** 06 9.4 (member): only the files whose display state is public. */
export async function listPublicFilesForMember(db: Reader, folderId: string, sort: FileListSort, now: Date) {
  return db
    .select({ id: files.id, folderId: files.folderId, displayName: files.displayName, sizeBytes: files.sizeBytes, updatedAt: files.updatedAt })
    .from(files)
    .where(and(eq(files.folderId, folderId), eq(files.status, 'active'), filePublicSql(now)))
    .orderBy(...orderFor(sort))
}

/** 07 6 usage: one statement over pending + active files. Call after locking the actor's profiles row. */
export async function sumQuotaUsage(tx: Tx, userId: string): Promise<{ userUsed: number; totalUsed: number }> {
  const rows = await tx
    .select({
      userUsed: sql<number>`coalesce(sum(${files.sizeBytes}) filter (where ${files.uploadedBy} = ${userId}), 0)::float8`,
      totalUsed: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::float8`,
    })
    .from(files)
    .where(inArray(files.status, ['pending', 'active']))
  const r = rows[0]
  return { userUsed: Number(r?.userUsed ?? 0), totalUsed: Number(r?.totalUsed ?? 0) }
}

/** 06 7.1 step 5. storage_path must equal folder_id/id.html (files_storage_path_ck). */
export async function insertPendingFile(
  tx: Tx,
  v: { id: string; folderId: string; uploadedBy: string; displayName: string; originalFilename: string; storagePath: string; sizeBytes: number; uploadExpiresAt: Date },
): Promise<void> {
  await tx.insert(files).values({ ...v, status: 'pending', charset: 'utf-8', contentType: 'text/html' })
}

/** 06 7.2 / 7.3: pending -> deleted. purgedAt is set only when the object is already gone. */
export async function markFileDeleted(
  tx: Tx,
  id: string,
  v: { by: string; at: Date; reason: NonNullable<FileRow['deleteReason']>; purgedAt: Date | null },
): Promise<void> {
  await tx
    .update(files)
    .set({ status: 'deleted', deletedAt: v.at, deletedBy: v.by, deleteReason: v.reason, uploadExpiresAt: null, purgedAt: v.purgedAt })
    .where(eq(files.id, id))
}

/** 06 7.2 step 5: pending -> active with the measured size. Returns the updated row. */
export async function activateFile(tx: Tx, id: string, v: { sizeBytes: number; charset: FileRow['charset']; at: Date }): Promise<FileRow | undefined> {
  const rows = await tx
    .update(files)
    .set({ status: 'active', sizeBytes: v.sizeBytes, charset: v.charset, activatedAt: v.at, uploadExpiresAt: null })
    .where(and(eq(files.id, id), eq(files.status, 'pending')))
    .returning()
  return rows[0]
}
