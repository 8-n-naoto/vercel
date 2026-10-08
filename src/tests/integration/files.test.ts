// 02 10 phase 3 (WP-4.2 share): files.update / updateRestrictions / delete, getDetail, the member list parity with S04, and
// folders.delete with files, against the dev database AND the dev Storage bucket.
// NOT RUN in WP-4.2 (T-038): the dev DB / Storage were not touched. Skipped without a database; run with npm run test:integration.
// Test fixture only: rows are read back and objects are placed with chosen state; there is no repository function for this.
// eslint-disable-next-line no-restricted-imports
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { auditLogs, files, shareLinks } from '@/server/db/schema'
import { fileEditsService, defaultFileEditDeps, type FileEditDeps } from '@/server/services/file-edits'
import { filesService } from '@/server/services/files'
import { foldersService } from '@/server/services/folders'
import { uploadsService } from '@/server/services/uploads'
import { getObjects } from '@/server/storage/objects'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFolderRow, createLinkRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const folderIds: string[] = []
const paths: string[] = []

afterAll(async () => {
  if (dbUp) {
    if (paths.length) await getObjects().removeMany(paths)
    if (folderIds.length) {
      const ids = (await getDb().select({ id: files.id }).from(files).where(inArray(files.folderId, folderIds))).map((r) => r.id)
      if (ids.length) await getDb().delete(shareLinks).where(inArray(shareLinks.fileId, ids))
      await getDb().delete(files).where(inArray(files.folderId, folderIds))
    }
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

const ctxOf = (u: TestUser, now = new Date()): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.52', userAgent: 'vitest', requestId: 'it-files' },
  now,
  actionName: 'it.files',
})
async function shapeOf(p: Promise<unknown>): Promise<AppErrorShape | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape
    throw e
  }
}
const rowOf = async (id: string) => (await getDb().select().from(files).where(eq(files.id, id)))[0]

async function newFolder(admin: TestUser): Promise<string> {
  const id = await createFolderRow(admin.id)
  folderIds.push(id)
  return id
}
/** An active file with a real object, made through the upload procedures (start, PUT, finalize). */
async function activeFile(admin: TestUser, folderId: string): Promise<string> {
  const body = new TextEncoder().encode('<!doctype html><p>hello</p>')
  const s = await uploadsService.startUpload(ctxOf(admin), { folderId, originalFilename: 'it.html', displayName: null, sizeBytes: body.length, contentType: 'text/html' })
  paths.push(`${folderId}/${s.fileId}.html`)
  const res = await fetch(s.uploadUrl, { method: 'PUT', headers: s.uploadHeaders, body: new Blob([body.slice()]) })
  expect(res.status).toBeLessThan(300)
  await uploadsService.finalizeUpload(ctxOf(admin), { fileId: s.fileId })
  return s.fileId
}
const R = { suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, downloadAllowed: false }

describe.skipIf(!dbUp)('files edit / delete / read (WP-4.2)', () => {
  it('files.delete: the object is gone, purged_at is set, open public links are revoked with file_deleted, one audit row', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await activeFile(admin, folderId)
    const linkId = await createLinkRow(id, admin.id)
    const out = await fileEditsService.delete(ctxOf(admin), { fileId: id })
    expect(out).toEqual({ revokedLinks: 1, purged: true })
    expect(await getObjects().stat(`${folderId}/${id}.html`)).toBeNull()
    expect(await rowOf(id)).toMatchObject({ status: 'deleted', deleteReason: 'user', deletedBy: admin.id })
    expect((await rowOf(id))?.purgedAt).not.toBeNull()
    const link = (await getDb().select().from(shareLinks).where(eq(shareLinks.id, linkId)))[0]
    expect(link).toMatchObject({ revokeReason: 'file_deleted', revokedBy: admin.id })
    expect(link?.revokedAt).not.toBeNull()
    const logs = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, id))
    expect(logs.filter((l) => l.action === 'file.deleted').map((l) => l.metadata)).toEqual([{ displayName: 'it', revokedLinks: 1 }])
    expect(await shapeOf(fileEditsService.delete(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('files.delete: a failing object removal keeps purged_at NULL (the daily job retries)', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await activeFile(admin, folderId)
    const deps: FileEditDeps = {
      ...defaultFileEditDeps,
      objects: () => ({ ...getObjects(), remove: async (p: string) => ({ removed: [], failed: [p] }) }),
    }
    expect(await fileEditsService.delete(ctxOf(admin), { fileId: id }, deps)).toMatchObject({ purged: false })
    const row = await rowOf(id)
    expect(row?.status).toBe('deleted')
    expect(row?.purgedAt).toBeNull()
    expect(await getObjects().stat(`${folderId}/${id}.html`)).not.toBeNull()
  })

  it('files.update: unchanged values write no audit row; a change writes file.updated with the changed fields only', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await activeFile(admin, folderId)
    await fileEditsService.update(ctxOf(admin), { fileId: id, displayName: 'it' })
    const d = await fileEditsService.update(ctxOf(admin), { fileId: id, displayName: 'renamed', charset: 'utf-8' })
    expect(d.displayName).toBe('renamed')
    const logs = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, id))
    expect(logs.filter((l) => l.action === 'file.updated').map((l) => l.metadata)).toEqual([
      { before: { displayName: 'it' }, after: { displayName: 'renamed' } },
    ])
  })

  it('files.updateRestrictions: a past expiresAt is rejected when changed and accepted when unchanged', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await activeFile(admin, folderId)
    const past = new Date(Date.now() - 3_600_000).toISOString()
    expect(await shapeOf(fileEditsService.updateRestrictions(ctxOf(admin), { fileId: id, ...R, expiresAt: past }))).toMatchObject({ code: 'VALIDATION_FAILED' })
    await getDb().update(files).set({ expiresAt: new Date(Math.floor(Date.parse(past) / 1000) * 1000) }).where(eq(files.id, id)) // seeded directly (expired file); stored values are second-truncated (toUtcSeconds), so is the seed
    const d = await fileEditsService.updateRestrictions(ctxOf(admin), { fileId: id, ...R, suspended: true, expiresAt: past })
    expect(d.restrictions.suspended).toBe(true)
  })

  it('isPublic changes: the member list and getDetail follow the display state, and the list count equals the S04 count', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const folderId = await newFolder(admin)
    await addMemberRow(folderId, member.id, admin.id)
    const a = await activeFile(admin, folderId)
    const b = await activeFile(admin, folderId)
    await fileEditsService.updateRestrictions(ctxOf(admin), { fileId: b, ...R, suspended: true })

    const list = await filesService.listInFolder(ctxOf(member), folderId, 'updated_desc')
    expect(list.files.map((f) => f.id)).toEqual([a])
    const card = (await foldersService.listVisible(ctxOf(member))).find((f) => f.id === folderId)
    expect(card?.fileCount).toBe(list.files.length) // S04 and the folder file list agree
    expect((await filesService.getDetail(ctxOf(member), a)).access).toBe('member')
    expect(await shapeOf(filesService.getDetail(ctxOf(member), b))).toMatchObject({ code: 'NOT_FOUND' })
    expect((await filesService.getDetail(ctxOf(admin), b)).access).toBe('admin')

    await fileEditsService.updateRestrictions(ctxOf(admin), { fileId: b, ...R })
    expect((await filesService.listInFolder(ctxOf(member), folderId, 'updated_desc')).files).toHaveLength(2)
  })

  it('getUploadContext: admin gets the limits; a member is FORBIDDEN and an outsider NOT_FOUND', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const outsider = await createTestUser('user')
    const folderId = await newFolder(admin)
    await addMemberRow(folderId, member.id, admin.id)
    const c = await filesService.getUploadContext(ctxOf(admin), folderId)
    expect(c.folder.id).toBe(folderId)
    expect(c.maxFileSizeBytes).toBeGreaterThan(0)
    expect(await shapeOf(filesService.getUploadContext(ctxOf(member), folderId))).toMatchObject({ code: 'FORBIDDEN' })
    expect(await shapeOf(filesService.getUploadContext(ctxOf(outsider), folderId))).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('folders.delete with files: { deletedFiles, revokedLinks, purgeFailed } and the objects are gone', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const f1 = await activeFile(admin, folderId)
    const f2 = await activeFile(admin, folderId)
    await createLinkRow(f1, admin.id)
    const name = (await foldersService.getDetail(ctxOf(admin), folderId)).name
    const out = await foldersService.remove(ctxOf(admin), { folderId, confirmName: name })
    expect(out).toEqual({ deletedFiles: 2, revokedLinks: 1, purgeFailed: 0 })
    for (const id of [f1, f2]) {
      expect(await getObjects().stat(`${folderId}/${id}.html`)).toBeNull()
      expect((await rowOf(id))?.purgedAt).not.toBeNull()
    }
  })
})
