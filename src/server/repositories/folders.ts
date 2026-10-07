import 'server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { files, folderMembers, folders, profiles, shareLinks } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import type { Reader } from './reader'
import { filePublicSql } from './files'
import { notImplemented } from './not-implemented'
import { activeShareLinkSql } from './share-links'

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

export async function insertFolder(tx: Tx, v: { name: string; description: string; createdBy: string }): Promise<string> {
  const rows = await tx.insert(folders).values(v).returning({ id: folders.id })
  const row = rows[0]
  if (!row) throw new Error('folders.insertFolder: no row returned')
  return row.id
}

export async function updateFolderText(tx: Tx, id: string, v: { name: string; description: string }): Promise<void> {
  await tx.update(folders).set(v).where(eq(folders.id, id))
}

export async function softDeleteFolder(tx: Tx, id: string, by: string, at: Date): Promise<void> {
  await tx.update(folders).set({ deletedAt: at, deletedBy: by }).where(eq(folders.id, id))
}

const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))

/**
 * 06 9.2: one statement. actorId = null lists every folder (admin) and counts every active file; otherwise only the
 * folders the user belongs to, counting the files whose display state is public (FILE_PUBLIC_SQL, 07 11.1).
 */
export async function listVisibleFolderRows(db: Reader, opts: { actorId: string | null; now: Date }) {
  const countFilter = opts.actorId === null ? sql`true` : filePublicSql(opts.now)
  return db
    .select({
      id: folders.id,
      name: folders.name,
      description: folders.description,
      updatedAt: sql<Date>`greatest(${folders.updatedAt}, coalesce(max(${files.updatedAt}), ${folders.updatedAt}))`.mapWith(toDate),
      fileCount: sql<number>`(count(${files.id}) filter (where ${countFilter}))::int`,
    })
    .from(folders)
    .leftJoin(files, and(eq(files.folderId, folders.id), eq(files.status, 'active')))
    .where(
      and(
        isNull(folders.deletedAt),
        opts.actorId === null
          ? undefined
          : sql`exists (select 1 from ${folderMembers} where ${folderMembers.folderId} = ${folders.id} and ${folderMembers.userId} = ${opts.actorId})`,
      ),
    )
    .groupBy(folders.id)
    .orderBy(asc(folders.name), asc(folders.createdAt))
}

/** 06 9.16: one statement with scalar subqueries. */
export async function listAdminFolderRows(db: Reader, now: Date) {
  return db
    .select({
      id: folders.id,
      name: folders.name,
      updatedAt: folders.updatedAt,
      createdById: profiles.id,
      createdByName: profiles.displayName,
      memberCount: sql<number>`(select count(*)::int from ${folderMembers} where ${folderMembers.folderId} = ${folders.id})`,
      fileCount: sql<number>`(select count(*)::int from ${files} where ${files.folderId} = ${folders.id} and ${files.status} = 'active')`,
      usedBytes: sql<number>`(select coalesce(sum(${files.sizeBytes}), 0)::float8 from ${files} where ${files.folderId} = ${folders.id} and ${files.status} in ('pending', 'active'))`,
      activeShareLinkCount: sql<number>`(select count(*)::int from ${shareLinks} inner join ${files} on ${files.id} = ${shareLinks.fileId} where ${files.folderId} = ${folders.id} and ${files.status} = 'active' and ${activeShareLinkSql(now)})`,
    })
    .from(folders)
    .innerJoin(profiles, eq(profiles.id, folders.createdBy))
    .where(isNull(folders.deletedAt))
    .orderBy(asc(folders.name), asc(folders.createdAt))
}
