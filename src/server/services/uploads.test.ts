import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import type { FileRow } from '@/server/repositories/files'
import { createFakeObjects } from '@/tests/fakes/objects'
import { defaultDisplayName, uploadsService, type UploadDeps, type UploadLimits, type UploadTx } from './uploads'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const FILE = '00000000-0000-4000-8000-000000000020'
const MB = 1_048_576
const now = new Date('2026-10-08T00:00:00.000Z')
const ctx: ServiceContext = {
  actor: { userId: 'u1', email: 'u1@example.com', displayName: 'U1', role: 'admin' },
  requestMeta: { ip: null, userAgent: null, requestId: 'r1' },
  now,
  actionName: 'files.test',
}
const LIMITS: UploadLimits = { maxFileBytes: 50 * MB, userLimitBytes: 900 * MB, totalLimitBytes: 900 * MB, apiKey: null }
const html = (n: number, tweak?: (b: Uint8Array) => void): Uint8Array => {
  const b = new Uint8Array(n).fill(0x61)
  b.set(new TextEncoder().encode('<!doctype html><p>').subarray(0, n))
  tweak?.(b)
  return b
}

async function errOf(p: Promise<unknown>): Promise<AppError['shape'] | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape
    throw e
  }
}

function fileRow(over: Partial<FileRow> = {}): FileRow {
  return {
    id: FILE,
    folderId: FOLDER,
    uploadedBy: 'u1',
    displayName: 'doc',
    originalFilename: 'doc.html',
    storagePath: `${FOLDER}/${FILE}.html`,
    contentType: 'text/html',
    charset: 'utf-8',
    sizeBytes: 100,
    status: 'pending',
    suspended: false,
    viewStartsAt: null,
    viewEndsAt: null,
    expiresAt: null,
    downloadAllowed: false,
    uploadExpiresAt: new Date(now.getTime() + 3_600_000),
    activatedAt: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    purgedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function setup(over: { file?: FileRow | null; usage?: { userUsed: number; totalUsed: number }; limits?: Partial<UploadLimits> } = {}) {
  const calls: string[] = []
  const objects = createFakeObjects()
  const state = { file: over.file === undefined ? fileRow() : over.file, inserted: null as Parameters<UploadTx['insertPending']>[0] | null }
  const markPurged = vi.fn<UploadDeps['markPurged']>(async () => void calls.push('markPurged'))
  const log = vi.fn()
  const audits: [string, unknown][] = []
  const deleted: { reason: string; purged: boolean }[] = []
  const makeTx = (): UploadTx => ({
    assertFolderManage: vi.fn(async (_id, lock) => {
      calls.push(`folder:${lock}`)
      return { id: FOLDER, name: 'Docs' }
    }),
    assertFile: vi.fn(async (_id, opts) => {
      calls.push(`file:${opts.lock ?? 'none'}:${opts.lockFile ? 'lock' : 'nolock'}`)
      if (!state.file || state.file.status === 'deleted') throw new AppError({ code: 'NOT_FOUND', message: 'x' })
      return { file: state.file, folderName: 'Docs' }
    }),
    lockOwnProfile: vi.fn(async () => void calls.push('profile')),
    usage: vi.fn(async () => over.usage ?? { userUsed: 0, totalUsed: 0 }),
    insertPending: vi.fn(async (v) => {
      calls.push('insert')
      state.inserted = v
    }),
    markDeleted: vi.fn(async (_id, reason, purged) => {
      calls.push('markDeleted')
      deleted.push({ reason, purged })
      if (state.file) state.file = { ...state.file, status: 'deleted' }
    }),
    activate: vi.fn(async (_id, v) => {
      calls.push('activate')
      state.file = fileRow({ ...v, status: 'active', activatedAt: now, uploadExpiresAt: null })
      return state.file
    }),
    auditUploaded: vi.fn(async (_f, v) => void audits.push(['file.uploaded', v])),
    auditVerificationFailed: vi.fn(async (_f, reason) => void audits.push(['file.upload_verification_failed', reason])),
    objects,
  })
  const deps: UploadDeps = {
    transaction: async (_c, fn) => fn(makeTx()),
    objects: () => objects,
    markPurged,
    limits: () => ({ ...LIMITS, ...over.limits }),
    newId: () => FILE,
    log,
  }
  return { deps, calls, objects, state, markPurged, log, audits, deleted }
}
const START = { folderId: FOLDER, originalFilename: 'Doc.HTML', displayName: null, sizeBytes: 1000, contentType: 'text/html' }

describe('startUpload (06 7.1)', () => {
  it('inserts a pending row, locks folder(share) then profile, and returns the signed URL with ctx.now + 2h', async () => {
    const t = setup()
    const out = await uploadsService.startUpload(ctx, START, t.deps)
    expect(t.calls).toEqual(['folder:share', 'profile', 'insert'])
    expect(t.state.inserted).toMatchObject({ id: FILE, folderId: FOLDER, storagePath: `${FOLDER}/${FILE}.html`, sizeBytes: 1000, displayName: 'Doc' })
    expect(out.fileId).toBe(FILE)
    expect(out.uploadUrl).toContain('fake.invalid')
    expect(out.uploadHeaders).toEqual({ 'content-type': 'text/html' })
    expect(out.uploadExpiresAt).toBe('2026-10-08T02:00:00.000Z')
    expect(t.state.inserted?.uploadExpiresAt.toISOString()).toBe('2026-10-08T02:00:00.000Z')
  })

  it('adds apikey only when the deps provide a publishable key, and never x-upsert', async () => {
    const t = setup({ limits: { apiKey: 'pk-value' } })
    const out = await uploadsService.startUpload(ctx, START, t.deps)
    expect(out.uploadHeaders).toEqual({ 'content-type': 'text/html', apikey: 'pk-value' })
  })

  it('uses the given display name; the default is the name without extension, cut to 200 characters', async () => {
    const t = setup()
    await uploadsService.startUpload(ctx, { ...START, displayName: 'Custom' }, t.deps)
    expect(t.state.inserted?.displayName).toBe('Custom')
    expect(defaultDisplayName('a'.repeat(250) + '.htm')).toBe('a'.repeat(200))
    expect(defaultDisplayName('.html')).toBe('.html')
  })

  it('accepts an empty contentType and exactly the maximum size', async () => {
    const t = setup()
    await expect(uploadsService.startUpload(ctx, { ...START, contentType: '', sizeBytes: 50 * MB }, t.deps)).resolves.toMatchObject({ fileId: FILE })
  })

  it('rejects an over-size declaration and a non-HTML content type before touching the database', async () => {
    const t = setup()
    const tooLarge = await errOf(uploadsService.startUpload(ctx, { ...START, sizeBytes: 50 * MB + 1 }, t.deps))
    expect(tooLarge).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(tooLarge?.fieldErrors?.sizeBytes?.[0]).toContain('50MB')
    const badType = await errOf(uploadsService.startUpload(ctx, { ...START, contentType: 'application/pdf' }, t.deps))
    expect(badType).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(badType?.fieldErrors?.contentType).toHaveLength(1)
    expect(t.calls).toEqual([])
  })

  it('QUOTA_EXCEEDED for the user limit first, then the total limit; exactly at the limit is allowed', async () => {
    const user = setup({ usage: { userUsed: 900 * MB - 999, totalUsed: 0 } })
    expect(await errOf(uploadsService.startUpload(ctx, START, user.deps))).toMatchObject({ code: 'QUOTA_EXCEEDED', message: expect.stringContaining('あなた') })
    expect(user.calls).toEqual(['folder:share', 'profile'])
    const total = setup({ usage: { userUsed: 0, totalUsed: 900 * MB - 999 } })
    expect(await errOf(uploadsService.startUpload(ctx, START, total.deps))).toMatchObject({ code: 'QUOTA_EXCEEDED', message: expect.stringContaining('全体') })
    const edge = setup({ usage: { userUsed: 900 * MB - 1000, totalUsed: 900 * MB - 1000 } })
    await expect(uploadsService.startUpload(ctx, START, edge.deps)).resolves.toMatchObject({ fileId: FILE })
  })

  it('a signed URL failure propagates and nothing is returned', async () => {
    const t = setup()
    t.objects.failNext('createSignedUploadUrl')
    await expect(uploadsService.startUpload(ctx, START, t.deps)).rejects.toThrow('createSignedUploadUrl')
  })
})

describe('finalizeUpload (06 7.2)', () => {
  it('activates a valid object with the measured size and charset, and writes file.uploaded', async () => {
    const t = setup()
    t.objects.put(`${FOLDER}/${FILE}.html`, html(250), 'text/html')
    const out = await uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps)
    expect(out).toMatchObject({ id: FILE, folderName: 'Docs', sizeBytes: 250, charset: 'utf-8', displayState: 'public', uploadedBy: { id: 'u1', displayName: 'U1' } })
    expect(t.audits).toEqual([['file.uploaded', { sizeBytes: 250, charset: 'utf-8' }]])
    expect(t.calls).toEqual(['file:none:nolock', 'file:share:lock', 'profile', 'activate'])
  })

  it('detects the charset from the meta tag', async () => {
    const t = setup()
    t.objects.put(`${FOLDER}/${FILE}.html`, new TextEncoder().encode('<meta charset="Shift_JIS">'), 'text/html')
    expect((await uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps)).charset).toBe('shift_jis')
  })

  it('is idempotent: an active file returns its detail without storage access, audit or writes (UV-24)', async () => {
    const t = setup({ file: fileRow({ status: 'active', sizeBytes: 250, activatedAt: now, uploadExpiresAt: null }) })
    const out = await uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps)
    expect(out).toMatchObject({ id: FILE, sizeBytes: 250 })
    expect(t.audits).toEqual([])
    expect(t.calls).toEqual(['file:none:nolock'])
  })

  it('CONFLICT for an expired pending row, including exactly now (UV-25)', async () => {
    for (const at of [new Date(now.getTime() - 1), now]) {
      const t = setup({ file: fileRow({ uploadExpiresAt: at }) })
      expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))).toMatchObject({ code: 'CONFLICT' })
    }
  })

  it('NOT_FOUND for a row of another uploader (UV-26) and for a deleted or unknown row', async () => {
    const other = setup({ file: fileRow({ uploadedBy: 'someone-else' }) })
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, other.deps))).toMatchObject({ code: 'NOT_FOUND' })
    const gone = setup({ file: null })
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, gone.deps))).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('UPLOAD_NOT_FOUND when the object is missing; the row is not touched (UV-22)', async () => {
    const t = setup()
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))).toMatchObject({ code: 'UPLOAD_NOT_FOUND' })
    expect(t.deleted).toEqual([])
  })

  it.each([
    ['empty', new Uint8Array(0), 'text/html', '空'],
    ['not_html', html(50), 'text/plain', 'HTML ファイルとして'],
    ['binary', html(50, (b) => (b[30] = 0)), 'text/html', 'テキスト'],
  ])('verification failure (%s): removes the object, marks the row deleted + purged, audits a failure', async (reason, bytes, mime, key) => {
    const t = setup()
    t.objects.put(`${FOLDER}/${FILE}.html`, bytes, mime)
    const e = await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))
    expect(e).toMatchObject({ code: 'UPLOAD_VERIFICATION_FAILED' })
    expect(e?.message).toContain(key)
    expect(t.objects.has(`${FOLDER}/${FILE}.html`)).toBe(false)
    expect(t.deleted).toEqual([{ reason: 'verification_failed', purged: true }])
    expect(t.audits).toEqual([['file.upload_verification_failed', reason]])
  })

  it('an over-size object is rejected without reading it (too_large)', async () => {
    const t = setup({ limits: { maxFileBytes: 100 } })
    t.objects.put(`${FOLDER}/${FILE}.html`, html(101), 'text/html')
    t.objects.failNext('readHead') // would throw if readHead were called
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))).toMatchObject({ code: 'UPLOAD_VERIFICATION_FAILED' })
    expect(t.audits).toEqual([['file.upload_verification_failed', 'too_large']])
  })

  it('when the object cannot be removed, purged_at stays NULL (left to the daily job)', async () => {
    const t = setup()
    t.objects.put(`${FOLDER}/${FILE}.html`, html(50), 'text/plain')
    t.objects.failNext('remove')
    await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))
    expect(t.deleted).toEqual([{ reason: 'verification_failed', purged: false }])
  })

  it('a row cancelled meanwhile is NOT_FOUND in the second transaction', async () => {
    const t = setup()
    t.objects.put(`${FOLDER}/${FILE}.html`, html(50), 'text/plain')
    const original = t.deps.transaction
    let n = 0
    t.deps.transaction = async (c, fn) => {
      if (++n === 2) t.state.file = fileRow({ status: 'active' })
      return original(c, fn)
    }
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))).toMatchObject({ code: 'NOT_FOUND' })
    expect(t.deleted).toEqual([])
  })

  it('QT-10: measured size over the user limit -> QUOTA_EXCEEDED, row deleted, audit reason quota, object removed afterwards', async () => {
    const t = setup({ file: fileRow({ sizeBytes: 1000 }), usage: { userUsed: 1000, totalUsed: 1000 }, limits: { userLimitBytes: 1500 } })
    t.objects.put(`${FOLDER}/${FILE}.html`, html(2000), 'text/html')
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, t.deps))).toMatchObject({ code: 'QUOTA_EXCEEDED' })
    expect(t.deleted).toEqual([{ reason: 'verification_failed', purged: false }])
    expect(t.audits).toEqual([['file.upload_verification_failed', 'quota']])
    expect(t.objects.has(`${FOLDER}/${FILE}.html`)).toBe(false)
    expect(t.markPurged).toHaveBeenCalledWith(FILE, now)
  })

  it('total limit is reported as the total message; a measured size at or below the declaration always passes', async () => {
    const total = setup({ file: fileRow({ sizeBytes: 1000 }), usage: { userUsed: 1000, totalUsed: 1000 }, limits: { totalLimitBytes: 1500 } })
    total.objects.put(`${FOLDER}/${FILE}.html`, html(2000), 'text/html')
    expect(await errOf(uploadsService.finalizeUpload(ctx, { fileId: FILE }, total.deps))).toMatchObject({ code: 'QUOTA_EXCEEDED', message: expect.stringContaining('全体') })
    const shrink = setup({ file: fileRow({ sizeBytes: 1000 }), usage: { userUsed: 5000, totalUsed: 5000 }, limits: { userLimitBytes: 10, totalLimitBytes: 10 } })
    shrink.objects.put(`${FOLDER}/${FILE}.html`, html(500), 'text/html')
    await expect(uploadsService.finalizeUpload(ctx, { fileId: FILE }, shrink.deps)).resolves.toMatchObject({ sizeBytes: 500 })
  })
})

describe('cancelUpload (06 7.3)', () => {
  it('marks the pending row deleted (upload_abandoned) under folders(share) -> files, then removes the object and sets purged_at', async () => {
    const t = setup()
    t.objects.put(`${FOLDER}/${FILE}.html`, html(10), 'text/html')
    await uploadsService.cancelUpload(ctx, { fileId: FILE }, t.deps)
    expect(t.calls).toEqual(['file:share:lock', 'markDeleted', 'markPurged'])
    expect(t.deleted).toEqual([{ reason: 'upload_abandoned', purged: false }])
    expect(t.objects.has(`${FOLDER}/${FILE}.html`)).toBe(false)
    expect(t.audits).toEqual([])
  })

  it('a removal failure keeps purged_at NULL and does not fail the call', async () => {
    const t = setup()
    t.objects.failNext('remove')
    await expect(uploadsService.cancelUpload(ctx, { fileId: FILE }, t.deps)).resolves.toBeUndefined()
    expect(t.markPurged).not.toHaveBeenCalled()
    expect(t.log).toHaveBeenCalledWith('upload.remove_failed', ctx)
  })

  it('NOT_FOUND for active, other uploader, deleted (second call) and unknown rows', async () => {
    for (const file of [fileRow({ status: 'active' }), fileRow({ uploadedBy: 'x' }), fileRow({ status: 'deleted' }), null]) {
      const t = setup({ file })
      expect(await errOf(uploadsService.cancelUpload(ctx, { fileId: FILE }, t.deps))).toMatchObject({ code: 'NOT_FOUND' })
    }
  })
})
