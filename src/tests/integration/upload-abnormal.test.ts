// WP-4.7 (T-040): abnormal uploads against the dev database AND the dev Storage bucket (02 10 phase 3 (2) Storage layer, destructive / huge / charset).
// NOT RUN (T-040): the dev DB / Storage were not touched. The Storage-layer cases assert the bucket settings of 05 4.3 (file_size_limit 52428800,
// allowed_mime_types text/html); run them after the D1 / D12 result fields are confirmed (WP-4.5). Skipped without a database.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
// Test fixture only: pending rows have no repository function for a chosen path.
// eslint-disable-next-line no-restricted-imports
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { auditLogs, files } from '@/server/db/schema'
import { getObjects } from '@/server/storage/objects'
import { uploadsService } from '@/server/services/uploads'
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

const MAX = 52_428_800
const ctxOf = (u: TestUser): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.52', userAgent: 'vitest', requestId: 'it-upload-abnormal' },
  now: new Date(),
  actionName: 'it.upload-abnormal',
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
const asset = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(process.cwd(), 'e2e', 'assets', name)))
/** An HTML body of exactly n bytes (generated here; nothing large is stored in the repository). */
function htmlOf(n: number): Uint8Array {
  const head = new TextEncoder().encode('<!doctype html><p>')
  const out = new Uint8Array(Math.max(n, head.length))
  out.fill(0x61)
  out.set(head)
  return out
}
async function put(url: string, headers: Record<string, string>, body: Uint8Array): Promise<number> {
  const res = await fetch(url, { method: 'PUT', headers, body: new Blob([body.slice()]) })
  return res.status
}
async function startAndPut(admin: TestUser, folderId: string, body: Uint8Array, over: { declared?: number; contentType?: string } = {}) {
  const s = await uploadsService.startUpload(ctxOf(admin), {
    folderId,
    originalFilename: 'it.html',
    displayName: null,
    sizeBytes: over.declared ?? body.length,
    contentType: 'text/html',
  })
  paths.push(`${folderId}/${s.fileId}.html`)
  const status = await put(s.uploadUrl, { ...s.uploadHeaders, ...(over.contentType ? { 'content-type': over.contentType } : {}) }, body)
  return { s, status }
}
async function newFolder(admin: TestUser): Promise<string> {
  const id = await createFolderRow(admin.id)
  folderIds.push(id)
  return id
}
const rowOf = async (id: string) => (await getDb().select().from(files).where(eq(files.id, id)))[0]

describe.skipIf(!dbUp)('abnormal uploads (WP-4.7)', () => {
  // ---- 02 10 phase 3 (2): the Storage layer, tested on its own -------------------------------------------------------------
  it('ST-1 Storage layer: a PUT whose content-type is not text/html is refused by the bucket; no object appears and finalize is UPLOAD_NOT_FOUND', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const { s, status } = await startAndPut(admin, folderId, htmlOf(100), { contentType: 'image/png' })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(await getObjects().stat(`${folderId}/${s.fileId}.html`)).toBeNull()
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: s.fileId }))).toMatchObject({ code: 'UPLOAD_NOT_FOUND' })
    expect((await rowOf(s.fileId))?.status).toBe('pending')
  })

  it('ST-2 Storage layer: a PUT of 50 MB + 1 byte is refused by the bucket (file_size_limit) even when startUpload was told a small size', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const { s, status } = await startAndPut(admin, folderId, htmlOf(MAX + 1), { declared: 100 })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(await getObjects().stat(`${folderId}/${s.fileId}.html`)).toBeNull()
  })

  it('ST-3 server layer: startUpload with 50 MB + 1 byte, a non-.html name or a zero size is VALIDATION_FAILED and creates no row', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const base = { folderId, originalFilename: 'it.html', displayName: null, sizeBytes: 10, contentType: 'text/html' }
    for (const over of [{ sizeBytes: MAX + 1 }, { originalFilename: 'it.txt' }, { originalFilename: 'it.html.exe' }, { sizeBytes: 0 }]) {
      expect(await shapeOf(uploadsService.startUpload(ctxOf(admin), { ...base, ...over }))).toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect(await getDb().select().from(files).where(eq(files.folderId, folderId))).toEqual([])
  })

  // ---- destructive HTML ----------------------------------------------------------------------------------------------------
  it('HT-1 destructive HTML (probe.html) is accepted as-is: active, stored bytes identical, one file.uploaded audit row (isolation is checked in WP-5.5)', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const body = asset('probe.html')
    const { s, status } = await startAndPut(admin, folderId, body)
    expect(status).toBeLessThan(300)
    const detail = await uploadsService.finalizeUpload(ctxOf(admin), { fileId: s.fileId })
    expect(detail.sizeBytes).toBe(body.length)
    expect((await rowOf(s.fileId))?.status).toBe('active')
    expect(Buffer.from(await getObjects().readHead(`${folderId}/${s.fileId}.html`, body.length)).equals(Buffer.from(body))).toBe(true)
    const logs = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, s.fileId))
    expect(logs.filter((l) => l.action === 'file.uploaded')).toHaveLength(1)
  })

  // ---- huge HTML -----------------------------------------------------------------------------------------------------------
  it('HG-1 a 50 MB HTML declared one byte smaller is never silently activated with a wrong size (refused by Storage, refused at finalize, or recorded with the measured size)', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const { s, status } = await startAndPut(admin, folderId, htmlOf(MAX), { declared: MAX - 1 })
    if (status >= 400) return // refused by Storage; nothing to finalize
    const shape = await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: s.fileId }))
    const row = await rowOf(s.fileId)
    if (shape === null) expect(row?.sizeBytes).toBe(MAX)
    else expect(row?.status).not.toBe('active')
  })

  // ---- charset variants ----------------------------------------------------------------------------------------------------
  const CHARSETS: [string, string][] = [
    ['charset-utf8-bom.html', 'utf-8'],
    ['charset-shift_jis.html', 'shift_jis'],
    ['charset-euc-jp.html', 'euc-jp'],
    ['charset-iso-2022-jp.html', 'iso-2022-jp'],
  ]
  for (const [name, charset] of CHARSETS) {
    it(`CS ${name}: becomes active with charset ${charset}, and the stored bytes are unchanged`, async () => {
      const admin = await createTestUser('admin')
      const folderId = await newFolder(admin)
      const body = asset(name)
      const { s, status } = await startAndPut(admin, folderId, body)
      expect(status).toBeLessThan(300)
      await uploadsService.finalizeUpload(ctxOf(admin), { fileId: s.fileId })
      expect(await rowOf(s.fileId)).toMatchObject({ status: 'active', charset })
      expect(Buffer.from(await getObjects().readHead(`${folderId}/${s.fileId}.html`, body.length)).equals(Buffer.from(body))).toBe(true)
    })
  }

  it('CS UTF-16 (BOM FF FE): UPLOAD_VERIFICATION_FAILED, row deleted + purged, object removed', async () => {
    const admin = await createTestUser('admin')
    const folderId = await newFolder(admin)
    const id = randomUUID()
    const p = `${folderId}/${id}.html`
    paths.push(p)
    await getDb()
      .insert(files)
      .values({
        id,
        folderId,
        uploadedBy: admin.id,
        displayName: 'it',
        originalFilename: 'it.html',
        storagePath: p,
        sizeBytes: 6,
        status: 'pending',
        uploadExpiresAt: new Date(Date.now() + 3_600_000),
      })
    const { signedUrl } = await getObjects().createSignedUploadUrl(p)
    expect(await put(signedUrl, { 'content-type': 'text/html' }, Uint8Array.from([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00]))).toBeLessThan(300)
    expect(await shapeOf(uploadsService.finalizeUpload(ctxOf(admin), { fileId: id }))).toMatchObject({ code: 'UPLOAD_VERIFICATION_FAILED' })
    const row = await rowOf(id)
    expect(row).toMatchObject({ status: 'deleted', deleteReason: 'verification_failed' })
    expect(row?.purgedAt).not.toBeNull()
    expect(await getObjects().stat(p)).toBeNull()
  })
})
