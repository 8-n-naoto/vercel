import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { files, folderMembers, folders } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import type { FolderLockMode } from './folders'
import { notImplemented } from './not-implemented'

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
