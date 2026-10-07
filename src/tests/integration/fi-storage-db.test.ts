// FI-4 automated half (T-051): Storage / DB inconsistencies of runbook 4 against the dev database AND the dev Storage bucket.
//   (c) deleted AND purged_at NULL with a REAL object: a failed removal leaves both, the next run removes the object and sets purged_at
//       (CR-06 uses a row without an object; this adds the object side). (b) an active row is never repaired or touched by steps 2-4,
//       whether its object exists or not (the repair is manual: runbook 4 (b)). (a) the orphan object case needs step 7 (WP-7.5, CR-13):
//       it.todo below. NOT RUN (dev DB / Storage not connected). Skipped without a database.
// Test fixture only: rows are read back directly.
// eslint-disable-next-line no-restricted-imports
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { files } from '@/server/db/schema'
import { runDaily, type DailyDeps } from '@/server/services/cron/daily'
import { getObjects } from '@/server/storage/objects'
import { cleanupTestUsers, createTestUser } from './helpers/auth-fixture'
import { cleanupCronFixtures, seedFile } from './helpers/cron-fixture'
import { cleanupFolderFixtures, createFolderRow } from './helpers/folder-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const NOW = new Date('2026-10-11T18:00:00.000Z') // a Sunday; steps 1-4 do not depend on the weekday
const DAY = 86_400_000
const paths: string[] = []

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

describe.skipIf(!dbUp)('FI-4 Storage / DB inconsistencies (runbook 4)', () => {
  it('FI-4c: deleted + purged_at NULL with a real object: a failed removal keeps both, the next run removes the object and sets purged_at', async () => {
    const { admin, folderId } = await fixture()
    const f = await seedFile(folderId, admin.id, { status: 'deleted', purgedAt: null })
    await put(f.path)
    const failing = () => ({ ...getObjects(), removeMany: async (p: string[]) => ({ removed: [], failed: p }) })
    expect(step(await run({ objects: failing }), 'purge_retry')).toMatchObject({ processed: 0, failed: 1 })
    expect((await rowOf(f.id))?.purgedAt).toBeNull()
    expect(await getObjects().stat(f.path)).not.toBeNull()
    expect(step(await run(), 'purge_retry')).toMatchObject({ processed: 1, failed: 0 })
    expect((await rowOf(f.id))?.purgedAt).not.toBeNull()
    expect(await getObjects().stat(f.path)).toBeNull()
    expect(step(await run(), 'purge_retry')).toMatchObject({ processed: 0, failed: 0 }) // idempotent
  })

  it('FI-4b: an active row whose object is missing stays active and untouched (no automatic repair); one with its object keeps the object', async () => {
    const { admin, folderId } = await fixture()
    const future = new Date(NOW.getTime() + 30 * DAY)
    const broken = await seedFile(folderId, admin.id, { status: 'active', expiresAt: future }) // no object was PUT
    const healthy = await seedFile(folderId, admin.id, { status: 'active', expiresAt: future })
    await put(healthy.path)
    const r = await run()
    expect(r.filter((x) => x.step !== 'keepalive').every((x) => x.failed === 0)).toBe(true)
    expect(await rowOf(broken.id)).toMatchObject({ status: 'active', purgedAt: null })
    expect(await rowOf(healthy.id)).toMatchObject({ status: 'active', purgedAt: null })
    expect(await getObjects().stat(healthy.path)).not.toBeNull()
    expect(await getObjects().stat(broken.path)).toBeNull() // what the manual comparison of runbook 4 (b) must report
  })

  it.todo('FI-4a / CR-13 / CR-14: orphan object (no files row) is removed by storage_reconcile on a UTC Sunday and left alone on other days (WP-7.5, step 7 not implemented)')
})
