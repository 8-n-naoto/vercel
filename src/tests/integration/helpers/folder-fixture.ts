// Fixtures for the folder authorization integration tests (06 3.4). Rows are written directly: the services that own them arrive later (WP-3.3+).
// Everything created here is removed by cleanupFolderFixtures(), which must run before cleanupTestUsers() (FKs are RESTRICT).
import { createHash, randomUUID } from 'node:crypto'
// Test fixture only: no repository functions exist for these writes yet.
// eslint-disable-next-line no-restricted-imports
import { inArray } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { files, folderMembers, folders, shareLinks } from '@/server/db/schema'

const folderIds: string[] = []
const fileIds: string[] = []
const linkIds: string[] = []

export async function createFolderRow(createdBy: string, opts: { deleted?: boolean } = {}): Promise<string> {
  const id = randomUUID()
  await getDb()
    .insert(folders)
    .values({ id, name: `it-${id.slice(0, 8)}`, createdBy, ...(opts.deleted ? { deletedAt: new Date(), deletedBy: createdBy } : {}) })
  folderIds.push(id)
  return id
}

export async function addMemberRow(folderId: string, userId: string, addedBy: string): Promise<void> {
  await getDb().insert(folderMembers).values({ folderId, userId, addedBy })
}

export async function createFileRow(folderId: string, uploadedBy: string, opts: { deleted?: boolean } = {}): Promise<string> {
  const id = randomUUID()
  const now = new Date()
  await getDb()
    .insert(files)
    .values({
      id,
      folderId,
      uploadedBy,
      displayName: `it-${id.slice(0, 8)}`,
      originalFilename: 'it.html',
      storagePath: `${folderId}/${id}.html`,
      sizeBytes: 10,
      ...(opts.deleted
        ? { status: 'deleted' as const, activatedAt: now, deletedAt: now, deletedBy: uploadedBy, deleteReason: 'user' as const }
        : { status: 'active' as const, activatedAt: now }),
    })
  fileIds.push(id)
  return id
}

export async function createLinkRow(fileId: string, createdBy: string): Promise<string> {
  const id = randomUUID()
  const tokenHash = createHash('sha256').update(id).digest('hex')
  await getDb()
    .insert(shareLinks)
    .values({ id, fileId, tokenHash, tokenHint: 'abcd', expiresAt: new Date(Date.now() + 3_600_000), createdBy })
  linkIds.push(id)
  return id
}

export async function cleanupFolderFixtures(): Promise<void> {
  const db = getDb()
  if (linkIds.length) await db.delete(shareLinks).where(inArray(shareLinks.id, linkIds))
  if (fileIds.length) await db.delete(files).where(inArray(files.id, fileIds))
  if (folderIds.length) {
    await db.delete(folderMembers).where(inArray(folderMembers.folderId, folderIds))
    await db.delete(folders).where(inArray(folders.id, folderIds))
  }
  linkIds.length = fileIds.length = folderIds.length = 0
}
