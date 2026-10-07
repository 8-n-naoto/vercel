import 'server-only'
import type { folders } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type FolderRow = typeof folders.$inferSelect

export async function findFolderById(id: string): Promise<FolderRow | undefined> {
  return notImplemented('folders.findFolderById', [id])
}

export async function listFoldersForUser(userId: string): Promise<FolderRow[]> {
  return notImplemented('folders.listFoldersForUser', [userId])
}
