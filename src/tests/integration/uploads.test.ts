// 02 10 phase 3 (WP-4.1 share) and 07 6.3 QT-09 / QT-10, 07 9.3 UV-22..UV-26, against the dev database AND the dev Storage bucket.
// NOT RUN in WP-4.1 (T-036): the dev DB / Storage were not touched. Skipped without a database; run with npm run test:integration.
import { randomUUID } from 'node:crypto'
// Test fixture only: pending rows with a chosen size / expiry have no repository function.
// eslint-disable-next-line no-restricted-imports
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { auditLogs, files } from '@/server/db/schema'
import { getObjects } from '@/server/storage/objects'
import { uploadsService, defaultUploadDeps, type UploadDeps } from '@/server/services/uploads'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { cleanupFolderFixtures, createFolderRow } from './helpers/folder-fixture'
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
    if (folderIds.length) await getDb().delete(files).where(inArray(files.folderId, folderIds))
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

const MB = 1_048_576
const ctxOf = (u: TestUser, now = new Date()): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.51', userAgent: 'vitest', requestId: 'it-uploads' },
  now,
  actionName: 'it.uploads',
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
const depsWith = (over: Partial<ReturnType<UploadDeps['limits']>>): UploadDeps => ({
  ...defaultUploadDeps,
  limits: () => ({ ...defaultUploadDeps.limits(), ...over }),
})
const html = (n: number): Uint8Array => {
  const head = new TextEncoder().encode('<!doctype html><p>')
  const out = new Uint8Array(Math.max(n, head.length))
  out.fill(0x61)
  out.set(head)
  return out
}

/** The browser side: PUT the bytes to the signed URL with the headers returned by startUpload. */
async function put(url: string, headers: Record<string, string>, body: Uint8Array): Promise<number> {
  const res = await fetch(url, { method: 'PUT', headers, body: new Blob([body.slice()]) })
  return res.status
}
async function start(admin: TestUser, folderId: string, size: number, deps?: UploadDeps, over: { contentType?: string; originalFilename?: string } = {}) {
  const out = await uploadsService.startUpload(
    ctxOf(admin),
    { folderId, originalFilename: over.originalFilename ?? 'it.html', displayName: null, sizeBytes: size, contentType: over.contentType ?? 'text/html' },
    deps,
  )
  paths.push(`${folderId}/${out.fileId}.html`)
  return out
}
/** A pending row written directly with a chosen declared size / expiry, and an object placed through a signed URL. */
async function pendingRow(admin: TestUser, folderId: string, o: { size: number; expired?: boolean; body?: Uint8Array; mime?: string }): Promise<string> {
  const id = randomUUID()
  const path = `${folderId}/${id}.html`
  paths.push(path)
  await getDb()
    .insert(files)
    .values({
      id,
      folderId,
      uploadedBy: admin.id,
      displayName: 'it',
      originalFilename: 'it.html',
      storagePath: path,
      sizeBytes: o.size,
      status: 'pending',
      uploadExpiresAt: new Date(Date.now() + (o.expired ? -60_000 : 3_600_000)),
    })
  if (o.body) {
    const { signedUrl } = await getObjects().createSignedUploadUrl(path)
    const status = await put(signedUrl, { 'content-type': o.mime ?? 'text/html' }, o.body)
    expect(status, `PUT status (mime ${o.mime ?? 'text/html'})`).toBeLessThan(300)
  }
  return id
}
async function newFolder(admin: TestUser): Promise<string> {
  const id = await createFolderRow(admin.id)
  folderIds.push(id)
  return id
}
const rowOf = async (id: string) => (await getDb().select().from(files).where(eq(files.id, id)))[0]

describe.skipIf(!dbUp)('uploads (WP-4.1)', () => {
  it('a 50 MB HTML becomes active; the same signed URL cannot be used twice (D1 / D6)', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const body = html(50 * MB)
    const s = await start(admin, folderId, body.length)
    expect(await put(s.uploadUrl, s.uploadHeaders, body)).toBeLessThan(300)
    expect(await put(s.uploadUrl, s.uploadHeaders, html(10))).toBeGreaterThanOrEqual(400)
    const detail = await uploadsService.finalizeUpload(ctxOf(admin), { fileId: s.fileId })
    expect(detail.sizeBytes).toBe(body.length)
    expect((await rowOf(s.fileId))?.status).toBe('active')
  })

  it('layer 1: startUpload rejects over-size and non-text/html declarations; layer 2: finalize rejects a non-HTML object', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    expect(await shapeOf(start(admin, folderId, 50 * MB + 1))).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(await shapeOf(start(admin, folderId, 10, undefined, { contentType: 'application/pdf' }))).toMatchObject({ code: 'VALIDATION_FAILED' })
    // The bucket (allowed_mime_types = text/html) already refuses other MIME types at the PUT (see upload-abnormal ST-1), so the
    // verification layer is exercised with a text/html object whose head is binary (a NUL byte): UPLOAD_VERIFICATION_FAILED (07 9.3).
    const binary = html(10)
    binary[5] = 0
    const id = await pendingRow(admin, folderId, { size: 10, body: binary })
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'UPLOAD_VERIFICATION_FAILED' })
  })

  it('QT-09: two concurrent startUpload of 500 MB each (limit 900 MB): one succeeds, one is QUOTA_EXCEEDED', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    // The default per-file limit is 50 MB, so the limits are raised for this vector (07 6.3 QT-09: user limit 900 MB; total limit not binding).
    const deps = depsWith({ maxFileBytes: 600 * MB, userLimitBytes: 900 * MB, totalLimitBytes: 10 ** 12 })
    const results = await Promise.allSettled([start(admin, folderId, 500 * MB, deps), start(admin, folderId, 500 * MB, deps)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected')
    expect(failed?.status === 'rejected' && failed.reason instanceof AppError && failed.reason.shape.code).toBe('QUOTA_EXCEEDED')
  })

  it('QT-10: declared 1,000 / measured 2,000 over the limit: QUOTA_EXCEEDED, row deleted (verification_failed), audit reason quota', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await pendingRow(admin, folderId, { size: 1000, body: html(2000) })
    const deps = depsWith({ userLimitBytes: 1500, totalLimitBytes: 10 ** 12 })
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: id }, deps))).toMatchObject({ code: 'QUOTA_EXCEEDED' })
    expect(await rowOf(id)).toMatchObject({ status: 'deleted', deleteReason: 'verification_failed' })
    const logs = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, id))
    expect(logs.map((l) => [l.action, l.result, l.metadata])).toEqual([['file.upload_verification_failed', 'failure', { reason: 'quota' }]])
  })

  it('UV-22: no object -> UPLOAD_NOT_FOUND and the row stays pending', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await pendingRow(admin, folderId, { size: 10 })
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'UPLOAD_NOT_FOUND' })
    expect((await rowOf(id))?.status).toBe('pending')
  })

  it('UV-23: a binary object -> UPLOAD_VERIFICATION_FAILED, row deleted + purged, object removed, one failure audit row', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const bin = html(100)
    bin[20] = 0
    const id = await pendingRow(admin, folderId, { size: 100, body: bin })
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'UPLOAD_VERIFICATION_FAILED' })
    const row = await rowOf(id)
    expect(row).toMatchObject({ status: 'deleted', deleteReason: 'verification_failed' })
    expect(row?.purgedAt).not.toBeNull()
    expect(await getObjects().stat(`${folderId}/${id}.html`)).toBeNull()
    const logs = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, id))
    expect(logs.map((l) => [l.action, l.result])).toEqual([['file.upload_verification_failed', 'failure']])
  })

  it('UV-24: finalize again after active returns the same FileDetail and adds no audit row', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await pendingRow(admin, folderId, { size: 100, body: html(100) })
    const first = await uploadsService.finalizeUpload(ctxOf(admin), { fileId: id })
    const second = await uploadsService.finalizeUpload(ctxOf(admin), { fileId: id })
    expect(second).toEqual(first)
    const logs = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, id))
    expect(logs.filter((l) => l.action === 'file.uploaded')).toHaveLength(1)
  })

  it('UV-25: an expired pending row -> CONFLICT', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await pendingRow(admin, folderId, { size: 100, expired: true, body: html(100) })
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'CONFLICT' })
  })

  it('UV-26: another admin finalizing / cancelling the pending row -> NOT_FOUND', async () => {
    const admin = await createTestUser('admin')
    const other = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await pendingRow(admin, folderId, { size: 100, body: html(100) })
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(other), { fileId: id }))).toMatchObject({ code: 'NOT_FOUND' })
    expect(await shapeOf(uploadsService.cancelUpload(ctxOf(other), { fileId: id }))).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('cancelUpload: pending -> deleted (upload_abandoned) and purged; a second call is NOT_FOUND', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = await pendingRow(admin, folderId, { size: 100, body: html(100) })
    await uploadsService.cancelUpload(ctxOf(admin), { fileId: id })
    const row = await rowOf(id)
    expect(row).toMatchObject({ status: 'deleted', deleteReason: 'upload_abandoned' })
    expect(row?.purgedAt).not.toBeNull()
    expect(await shapeOf(uploadsService.cancelUpload(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'NOT_FOUND' })
  })
})
