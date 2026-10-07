// 07 10.3 CR-01..CR-07, CR-17, CR-19 (WP-4.3): the daily job steps 2-4 against the dev database AND the dev Storage bucket.
// NOT RUN in WP-4.3 (T-039): the dev DB / Storage were not touched. Skipped without a database; run with npm run test:integration.
// CR-08 and later belong to WP-7.5. now = 2026-10-11T18:00:00Z (Sunday), retention days = default (30).
// The steps select over the whole table: run against a database without other expired pending / active rows
// (the processed counts are exact only then). Every vector checks the first run and a second run with the same now.
// Test fixture only: rows are read back directly.
// eslint-disable-next-line no-restricted-imports
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { files, shareLinks } from '@/server/db/schema'
import { defaultDailyStore, runDaily, type DailyDeps } from '@/server/services/cron/daily'
import { getObjects } from '@/server/storage/objects'
import { cleanupTestUsers, createTestUser } from './helpers/auth-fixture'
import { cleanupCronFixtures, seedFile } from './helpers/cron-fixture'
import { cleanupFolderFixtures, createFolderRow, createLinkRow } from './helpers/folder-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const NOW = new Date('2026-10-11T18:00:00.000Z')
const DAY = 86_400_000
const paths: string[] = []

afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  if (dbUp) {
    if (paths.length) await getObjects().removeMany(paths)
    await cleanupCronFixtures()
    await cleanupFolderFixtures()
    await cleanupTestUsers()
  }
  await closeDb()
})

const run = (overrides: Partial<DailyDeps> = {}) => runDaily({ now: () => NOW, ...overrides })
const step = (r: Awaited<ReturnType<typeof runDaily>>, name: string) => r.find((x) => x.step === name)
const rowOf = async (id: string) => (await getDb().select().from(files).where(eq(files.id, id)))[0]
/** Places an object the way the browser PUT does. */
async function put(path: string): Promise<void> {
  paths.push(path)
  const { signedUrl } = await getObjects().createSignedUploadUrl(path)
  const res = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: new Blob(['<p>x</p>']) })
  expect(res.status).toBeLessThan(300)
}
async function fixture() {
  const admin = await createTestUser('admin')
  return { admin, folderId: await createFolderRow(admin.id) }
}

describe.skipIf(!dbUp)('daily job steps 2-4 (WP-4.3)', () => {
  it('CR-01 / CR-02: a pending file past upload_expires_at is deleted with its object; upload_expires_at = now is left alone', async () => {
    const { admin, folderId } = await fixture()
    const old = await seedFile(folderId, admin.id, { status: 'pending', uploadExpiresAt: new Date(NOW.getTime() - 1) })
    const edge = await seedFile(folderId, admin.id, { status: 'pending', uploadExpiresAt: NOW })
    await put(old.path)
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 1, failed: 0 })
    expect(await rowOf(old.id)).toMatchObject({ status: 'deleted', deleteReason: 'upload_abandoned', deletedBy: null, uploadExpiresAt: null })
    expect((await rowOf(old.id))?.purgedAt).not.toBeNull()
    expect(await getObjects().stat(old.path)).toBeNull()
    expect((await rowOf(edge.id))?.status).toBe('pending')
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 0, failed: 0 })
    expect((await rowOf(edge.id))?.status).toBe('pending')
  })

  it('CR-03: a pending file whose object was never PUT is purged (a missing object counts as removed)', async () => {
    const { admin, folderId } = await fixture()
    const f = await seedFile(folderId, admin.id, { status: 'pending', uploadExpiresAt: new Date(NOW.getTime() - 1000) })
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 1, failed: 0 })
    expect((await rowOf(f.id))?.purgedAt).not.toBeNull()
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 0 })
  })

  it('CR-04 / CR-05: an active file expired more than 30 days ago is deleted and its links revoked; exactly 30 days is left alone', async () => {
    const { admin, folderId } = await fixture()
    const old = await seedFile(folderId, admin.id, { status: 'active', expiresAt: new Date(NOW.getTime() - 30 * DAY - 1) })
    const edge = await seedFile(folderId, admin.id, { status: 'active', expiresAt: new Date(NOW.getTime() - 30 * DAY) })
    const l1 = await createLinkRow(old.id, admin.id)
    const l2 = await createLinkRow(old.id, admin.id)
    await put(old.path)
    expect(step(await run(), 'expired_files')).toMatchObject({ processed: 1, failed: 0 })
    expect(await rowOf(old.id)).toMatchObject({ status: 'deleted', deleteReason: 'expired', deletedBy: null })
    expect((await rowOf(old.id))?.purgedAt).not.toBeNull()
    expect(await getObjects().stat(old.path)).toBeNull()
    for (const id of [l1, l2]) {
      const l = (await getDb().select().from(shareLinks).where(eq(shareLinks.id, id)))[0]
      expect(l).toMatchObject({ revokeReason: 'file_deleted', revokedBy: null })
      expect(l?.revokedAt).not.toBeNull()
    }
    expect((await rowOf(edge.id))?.status).toBe('active')
    expect(step(await run(), 'expired_files')).toMatchObject({ processed: 0, failed: 0 })
    expect((await rowOf(edge.id))?.status).toBe('active')
  })

  it('CR-06: a failing removal keeps purged_at NULL (failed 1); the second run purges it', async () => {
    const { admin, folderId } = await fixture()
    const f = await seedFile(folderId, admin.id, { status: 'deleted', purgedAt: null })
    let failOnce = true
    const objects = () => {
      const real = getObjects()
      return {
        ...real,
        removeMany: async (p: string[]) => {
          if (failOnce) {
            failOnce = false
            return { removed: [], failed: p }
          }
          return real.removeMany(p)
        },
      }
    }
    expect(step(await run({ objects }), 'purge_retry')).toMatchObject({ processed: 0, failed: 1 })
    expect((await rowOf(f.id))?.purgedAt).toBeNull()
    expect(step(await run({ objects }), 'purge_retry')).toMatchObject({ processed: 1, failed: 0 })
    expect((await rowOf(f.id))?.purgedAt).not.toBeNull()
  })

  it('CR-07: 501 abandoned pending files -> processed 500 and cron.step_truncated; the second run processes the last one', async () => {
    const { admin, folderId } = await fixture()
    for (let i = 0; i < 501; i++) await seedFile(folderId, admin.id, { status: 'pending', uploadExpiresAt: new Date(NOW.getTime() - 1000 - i) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 500 })
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('cron.step_truncated')
    log.mockRestore()
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 1 })
  })

  it('CR-17: a step 2 exception gives failed 1 and steps 3 and 4 still run (system.cron_daily and HTTP 200: WP-7.5 / route)', async () => {
    const { admin, folderId } = await fixture()
    const f = await seedFile(folderId, admin.id, { status: 'deleted', purgedAt: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = {
      ...defaultDailyStore,
      abandonPending: async (): Promise<never> => {
        throw new Error('injected')
      },
    }
    const r = await run({ store })
    expect(step(r, 'pending_cleanup')).toMatchObject({ processed: 0, failed: 1 })
    expect(step(r, 'expired_files')).toBeDefined()
    expect(step(r, 'purge_retry')).toBeDefined()
    expect((await rowOf(f.id))?.purgedAt).not.toBeNull()
    expect(step(await run({ store }), 'pending_cleanup')).toMatchObject({ failed: 1 }) // same outcome on the second run
  })

  it('CR-19: a pending row locked by another transaction is skipped, then processed after the lock is released', async () => {
    const { admin, folderId } = await fixture()
    const f = await seedFile(folderId, admin.id, { status: 'pending', uploadExpiresAt: new Date(NOW.getTime() - 1000) })
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    let locked: () => void = () => undefined
    const lockedP = new Promise<void>((r) => (locked = r))
    const holder = getDb().transaction(async (tx) => {
      await tx.select().from(files).where(eq(files.id, f.id)).for('update')
      locked()
      await gate
    })
    await lockedP
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 0 })
    expect((await rowOf(f.id))?.status).toBe('pending')
    release()
    await holder
    expect(step(await run(), 'pending_cleanup')).toMatchObject({ processed: 1 })
    expect((await rowOf(f.id))?.status).toBe('deleted')
  })
})
