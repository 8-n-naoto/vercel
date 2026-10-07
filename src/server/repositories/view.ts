import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { files, folderMembers, folders } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'

/**
 * 06 8.4 step 1: file + folder + the actor's membership in one statement. Unlike assertFileRole, a deleted file is returned
 * (evaluateAccess answers NOT_FOUND and the denial is logged). No lock.
 */
export async function findFileForTicket(executor: Tx | Db, fileId: string, actorId: string) {
  const fi = alias(files, 'fi')
  const f = alias(folders, 'f')
  const fm = alias(folderMembers, 'fm')
  const rows = await executor
    .select({
      file: fi,
      folderId: f.id,
      folderName: f.name,
      folderDeletedAt: f.deletedAt,
      isMember: sql<boolean>`(${fm.userId} is not null)`,
    })
    .from(fi)
    .innerJoin(f, eq(f.id, fi.folderId))
    .leftJoin(fm, and(eq(fm.folderId, f.id), eq(fm.userId, actorId)))
    .where(eq(fi.id, fileId))
    .limit(1)
  return rows[0]
}
