import 'server-only'
import type { shareLinks } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type ShareLinkRow = typeof shareLinks.$inferSelect

export async function findShareLinkByTokenHash(tokenHash: string): Promise<ShareLinkRow | undefined> {
  return notImplemented('shareLinks.findShareLinkByTokenHash', [tokenHash])
}

export async function listShareLinksForFile(fileId: string): Promise<ShareLinkRow[]> {
  return notImplemented('shareLinks.listShareLinksForFile', [fileId])
}
