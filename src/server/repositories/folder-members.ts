import 'server-only'
import type { folderMembers } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type FolderMemberRow = typeof folderMembers.$inferSelect

export async function listFolderMembers(folderId: string): Promise<FolderMemberRow[]> {
  return notImplemented('folderMembers.listFolderMembers', [folderId])
}

export async function isFolderMember(folderId: string, userId: string): Promise<boolean> {
  return notImplemented('folderMembers.isFolderMember', [folderId, userId])
}
