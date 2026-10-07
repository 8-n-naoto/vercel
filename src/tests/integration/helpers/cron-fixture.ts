// Fixtures for the daily job integration tests (07 10.3). Rows are written directly with chosen state (no repository function
// exists for this). Everything is removed by cleanupCronFixtures(), which must run before cleanupFolderFixtures().
import { randomUUID } from 'node:crypto'
// Test fixture only.
// eslint-disable-next-line no-restricted-imports
import { inArray } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { files, shareLinks } from '@/server/db/schema'

const ids: string[] = []

type Seed =
  | { status: 'pending'; uploadExpiresAt: Date }
  | { status: 'active'; expiresAt: Date }
  | { status: 'deleted'; purgedAt: Date | null }

/** Inserts one file row in the given state; returns its id and storage path. */
export async function seedFile(folderId: string, uploadedBy: string, seed: Seed): Promise<{ id: string; path: string }> {
  const id = randomUUID()
  const path = `${folderId}/${id}.html`
  const at = new Date('2026-01-01T00:00:00.000Z')
  const base = { id, folderId, uploadedBy, displayName: `it-${id.slice(0, 8)}`, originalFilename: 'it.html', storagePath: path, sizeBytes: 10 }
  const state =
    seed.status === 'pending'
      ? { status: 'pending' as const, uploadExpiresAt: seed.uploadExpiresAt }
      : seed.status === 'active'
        ? { status: 'active' as const, activatedAt: at, expiresAt: seed.expiresAt }
        : { status: 'deleted' as const, activatedAt: at, deletedAt: at, deleteReason: 'user' as const, deletedBy: uploadedBy, purgedAt: seed.purgedAt }
  await getDb().insert(files).values({ ...base, ...state })
  ids.push(id)
  return { id, path }
}

/** Deletes the seeded rows and the share links that point at them. */
export async function cleanupCronFixtures(): Promise<void> {
  if (ids.length) {
    await getDb().delete(shareLinks).where(inArray(shareLinks.fileId, ids))
    await getDb().delete(files).where(inArray(files.id, ids))
  }
  ids.length = 0
}
