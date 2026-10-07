import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { folderMembers, profiles } from '@/server/db/schema'
import type { Tx } from './audit-logs'
import type { Reader } from './reader'
import { notImplemented } from './not-implemented'

export type FolderMemberRow = typeof folderMembers.$inferSelect

export async function listFolderMembers(folderId: string): Promise<FolderMemberRow[]> {
  return notImplemented('folderMembers.listFolderMembers', [folderId])
}

export async function isFolderMember(folderId: string, userId: string): Promise<boolean> {
  return notImplemented('folderMembers.isFolderMember', [folderId, userId])
}

/** 06 6.4 step 3. Returns the user ids that were actually inserted (rows that already existed are skipped). */
export async function insertFolderMembers(tx: Tx, folderId: string, userIds: string[], addedBy: string): Promise<string[]> {
  const rows = await tx
    .insert(folderMembers)
    .values(userIds.map((userId) => ({ folderId, userId, addedBy })))
    .onConflictDoNothing({ target: [folderMembers.folderId, folderMembers.userId] })
    .returning({ userId: folderMembers.userId })
  return rows.map((r) => r.userId)
}

/** 06 6.5. false when the user was not a member. */
export async function deleteFolderMember(tx: Tx, folderId: string, userId: string): Promise<boolean> {
  const rows = await tx
    .delete(folderMembers)
    .where(and(eq(folderMembers.folderId, folderId), eq(folderMembers.userId, userId)))
    .returning({ userId: folderMembers.userId })
  return rows.length > 0
}

/** 06 9.5: one statement. includeDisabled = false drops disabled users (the member view). */
export async function listMemberRows(db: Reader, folderId: string, includeDisabled: boolean) {
  return db
    .select({
      userId: profiles.id,
      displayName: profiles.displayName,
      email: profiles.email,
      addedAt: folderMembers.createdAt,
      disabledAt: profiles.disabledAt,
    })
    .from(folderMembers)
    .innerJoin(profiles, eq(profiles.id, folderMembers.userId))
    .where(and(eq(folderMembers.folderId, folderId), includeDisabled ? undefined : isNull(profiles.disabledAt)))
    .orderBy(asc(profiles.displayName), asc(folderMembers.userId))
}
