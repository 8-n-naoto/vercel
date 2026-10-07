import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { folderMembers, folders } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import { notImplemented } from './not-implemented'

export type FolderRow = typeof folders.$inferSelect

export async function findFolderById(id: string): Promise<FolderRow | undefined> {
  return notImplemented('folders.findFolderById', [id])
}

export async function listFoldersForUser(userId: string): Promise<FolderRow[]> {
  return notImplemented('folders.listFoldersForUser', [userId])
}

/** Lock on the folders row (06 3.4). */
export type FolderLockMode = 'none' | 'share' | 'update'

/** 06 3.4 assertFolderRole: one statement resolves the folder and the actor's membership (IDOR, 02 9.2.2). */
export async function findFolderWithMembership(tx: Tx | Db, folderId: string, actorId: string, lock: FolderLockMode) {
  const f = alias(folders, 'f') // FOR ... OF needs an unqualified name
  const fm = alias(folderMembers, 'fm')
  const q = tx
    .select({ folder: f, isMember: sql<boolean>`(${fm.userId} is not null)` })
    .from(f)
    .leftJoin(fm, and(eq(fm.folderId, f.id), eq(fm.userId, actorId)))
    .where(eq(f.id, folderId))
    .limit(1)
  const rows = lock === 'none' ? await q : await q.for(lock, { of: f })
  return rows[0]
}
