import 'server-only'
import type { files } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type FileRow = typeof files.$inferSelect

export async function findFileById(id: string): Promise<FileRow | undefined> {
  return notImplemented('files.findFileById', [id])
}

export async function listFilesInFolder(folderId: string): Promise<FileRow[]> {
  return notImplemented('files.listFilesInFolder', [folderId])
}
