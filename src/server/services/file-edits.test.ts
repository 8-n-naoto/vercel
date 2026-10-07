import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import type { FileRow } from '@/server/repositories/files'
import { createFakeObjects } from '@/tests/fakes/objects'
import { fileEditsService, type FileEditDeps, type FileEditTx } from './file-edits'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const FILE = '00000000-0000-4000-8000-000000000020'
const now = new Date('2026-10-08T00:00:00.000Z')
const ctx: ServiceContext = {
  actor: { userId: 'u1', email: 'u1@example.com', displayName: 'U1', role: 'admin' },
  requestMeta: { ip: null, userAgent: null, requestId: 'r1' },
  now,
  actionName: 'files.test',
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
    status: 'active',
    suspended: false,
    viewStartsAt: null,
    viewEndsAt: null,
    expiresAt: null,
    downloadAllowed: false,
    uploadExpiresAt: null,
    activatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    purgedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function setup(file: FileRow | null = fileRow(), revoked = 0) {
  const calls: string[] = []
  const audits: [string, unknown][] = []
  const objects = createFakeObjects()
  const state = { file }
  const current = (): FileRow => {
    if (!state.file) throw new Error('no file')
    return state.file
  }
  const markPurged = vi.fn<FileEditDeps['markPurged']>(async () => void calls.push('markPurged'))
  const log = vi.fn()
  const tx: FileEditTx = {
    assertFile: vi.fn(async () => {
      calls.push('assert')
      if (!state.file) throw new AppError({ code: 'NOT_FOUND', message: 'x' })
      return { file: state.file, folderName: 'Docs' }
    }),
    uploaderName: vi.fn(async () => 'Uploader'),
    updateText: vi.fn(async (_id, v) => {
      calls.push('updateText')
      const next = { ...current(), ...v }
      state.file = next
      return next
    }),
    updateRestrictions: vi.fn(async (_id, v) => {
      calls.push('updateRestrictions')
      const next = { ...current(), ...v }
      state.file = next
      return next
    }),
    markDeleted: vi.fn(async () => void calls.push('markDeleted')),
    revokeLinks: vi.fn(async () => {
      calls.push('revoke')
      return revoked
    }),
    audit: {
      updated: vi.fn(async (_f, before, after) => void audits.push(['file.updated', { before, after }])),
      restrictionsUpdated: vi.fn(async (_f, before, after) => void audits.push(['file.restrictions_updated', { before, after }])),
      deleted: vi.fn(async (_f, n) => void audits.push(['file.deleted', n])),
    },
  }
  const deps: FileEditDeps = {
    transaction: async (_c, _id, fn) => {
      const r = await fn(tx)
      calls.push('commit')
      return r
    },
    objects: () => objects,
    markPurged,
    log,
  }
  return { deps, calls, audits, objects, state, markPurged, log, tx }
}

const R = { fileId: FILE, suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, downloadAllowed: false }

describe('files.update (06 7.4)', () => {
  it('updates the changed fields, audits before/after of those only, and returns the detail', async () => {
    const t = setup()
    const out = await fileEditsService.update(ctx, { fileId: FILE, displayName: 'new', charset: 'utf-8' }, t.deps)
    expect(out.displayName).toBe('new')
    expect(out.uploadedBy).toEqual({ id: 'u1', displayName: 'Uploader' })
    expect(t.tx.updateText).toHaveBeenCalledWith(FILE, { displayName: 'new' })
    expect(t.audits).toEqual([['file.updated', { before: { displayName: 'doc' }, after: { displayName: 'new' } }]])
    expect(t.calls).toEqual(['assert', 'updateText', 'commit'])
  })

  it('the same values are a no-op (no write, no audit)', async () => {
    const t = setup()
    const out = await fileEditsService.update(ctx, { fileId: FILE, displayName: 'doc', charset: 'utf-8' }, t.deps)
    expect(out.displayName).toBe('doc')
    expect(t.tx.updateText).not.toHaveBeenCalled()
    expect(t.audits).toEqual([])
  })

  it.each([['deleted / absent', null], ['pending', fileRow({ status: 'pending' })]] as const)('%s file is NOT_FOUND', async (_n, f) => {
    const t = setup(f)
    expect((await errOf(fileEditsService.update(ctx, { fileId: FILE, charset: 'shift_jis' }, t.deps)))?.code).toBe('NOT_FOUND')
    expect(t.tx.updateText).not.toHaveBeenCalled()
  })

  it('a charset change is audited', async () => {
    const t = setup()
    await fileEditsService.update(ctx, { fileId: FILE, charset: 'shift_jis' }, t.deps)
    expect(t.audits).toEqual([['file.updated', { before: { charset: 'utf-8' }, after: { charset: 'shift_jis' } }]])
  })
})

describe('files.updateRestrictions (06 7.5, 07 12)', () => {
  it('stores a future expiresAt truncated to seconds and audits the changed fields as ISO strings', async () => {
    const t = setup()
    const out = await fileEditsService.updateRestrictions(
      ctx,
      { ...R, suspended: true, expiresAt: '2026-10-09T00:00:00.789Z' },
      t.deps,
    )
    expect(t.tx.updateRestrictions).toHaveBeenCalledWith(FILE, {
      suspended: true,
      downloadAllowed: false,
      viewStartsAt: null,
      viewEndsAt: null,
      expiresAt: new Date('2026-10-09T00:00:00.000Z'),
    })
    expect(out.restrictions.expiresAt).toBe('2026-10-09T00:00:00.000Z')
    expect(out.displayState).toBe('suspended')
    expect(t.audits).toEqual([
      [
        'file.restrictions_updated',
        { before: { suspended: false, expiresAt: null }, after: { suspended: true, expiresAt: '2026-10-09T00:00:00.000Z' } },
      ],
    ])
  })

  it('a changed expiresAt in the past is VALIDATION_FAILED (fieldErrors.expiresAt) and nothing is written', async () => {
    const t = setup()
    const e = await errOf(fileEditsService.updateRestrictions(ctx, { ...R, expiresAt: '2026-10-07T00:00:00.000Z' }, t.deps))
    expect(e?.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(e?.fieldErrors ?? {})).toEqual(['expiresAt'])
    expect(t.tx.updateRestrictions).not.toHaveBeenCalled()
    expect(t.audits).toEqual([])
  })

  it('now itself is in the past (<= now)', async () => {
    const t = setup()
    const e = await errOf(fileEditsService.updateRestrictions(ctx, { ...R, expiresAt: now.toISOString() }, t.deps))
    expect(e?.code).toBe('VALIDATION_FAILED')
  })

  it('an unchanged past expiresAt is accepted so other fields can be saved', async () => {
    const past = new Date('2026-10-01T00:00:00.000Z')
    const t = setup(fileRow({ expiresAt: past }))
    const out = await fileEditsService.updateRestrictions(ctx, { ...R, suspended: true, expiresAt: '2026-10-01T00:00:00.400Z' }, t.deps)
    expect(out.restrictions.suspended).toBe(true)
    expect(t.audits).toEqual([['file.restrictions_updated', { before: { suspended: false }, after: { suspended: true } }]])
  })

  it('clearing expiresAt (null) is allowed', async () => {
    const t = setup(fileRow({ expiresAt: new Date('2026-10-01T00:00:00.000Z') }))
    await fileEditsService.updateRestrictions(ctx, R, t.deps)
    expect(t.audits).toEqual([
      ['file.restrictions_updated', { before: { expiresAt: '2026-10-01T00:00:00.000Z' }, after: { expiresAt: null } }],
    ])
  })

  it('an end before the start is VALIDATION_FAILED (fieldErrors.viewEndsAt)', async () => {
    const t = setup()
    const e = await errOf(
      fileEditsService.updateRestrictions(ctx, { ...R, viewStartsAt: '2026-10-10T00:00:00Z', viewEndsAt: '2026-10-09T00:00:00Z' }, t.deps),
    )
    expect(e?.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(e?.fieldErrors ?? {})).toEqual(['viewEndsAt'])
  })

  it('identical values are a no-op', async () => {
    const t = setup()
    await fileEditsService.updateRestrictions(ctx, R, t.deps)
    expect(t.tx.updateRestrictions).not.toHaveBeenCalled()
    expect(t.audits).toEqual([])
  })

  it('a pending file is NOT_FOUND', async () => {
    const t = setup(fileRow({ status: 'pending' }))
    expect((await errOf(fileEditsService.updateRestrictions(ctx, R, t.deps)))?.code).toBe('NOT_FOUND')
  })
})

describe('files.delete (06 7.6)', () => {
  it('marks deleted, revokes links, audits, commits, then removes the object and sets purged_at', async () => {
    const t = setup(fileRow(), 2)
    const out = await fileEditsService.delete(ctx, { fileId: FILE }, t.deps)
    expect(out).toEqual({ revokedLinks: 2, purged: true })
    expect(t.calls).toEqual(['assert', 'markDeleted', 'revoke', 'commit', 'markPurged'])
    expect(t.audits).toEqual([['file.deleted', 2]])
    expect(t.markPurged).toHaveBeenCalledWith(FILE, now)
  })

  it('a pending file can be deleted too', async () => {
    const t = setup(fileRow({ status: 'pending' }))
    expect((await fileEditsService.delete(ctx, { fileId: FILE }, t.deps)).purged).toBe(true)
  })

  it('a failing remove keeps purged_at NULL (purged: false) and the deletion stays committed', async () => {
    const t = setup(fileRow(), 1)
    t.objects.failNext('remove')
    const out = await fileEditsService.delete(ctx, { fileId: FILE }, t.deps)
    expect(out).toEqual({ revokedLinks: 1, purged: false })
    expect(t.markPurged).not.toHaveBeenCalled()
    expect(t.calls).toContain('commit')
    expect(JSON.stringify(t.log.mock.calls)).not.toContain(FOLDER) // no path in the log
  })

  it('a failing markPurged is purged: false (the daily job retries)', async () => {
    const t = setup()
    t.markPurged.mockRejectedValueOnce(new Error('db down'))
    expect((await fileEditsService.delete(ctx, { fileId: FILE }, t.deps)).purged).toBe(false)
  })

  it('an absent or deleted file is NOT_FOUND and nothing is removed', async () => {
    const t = setup(null)
    expect((await errOf(fileEditsService.delete(ctx, { fileId: FILE }, t.deps)))?.code).toBe('NOT_FOUND')
    expect(t.markPurged).not.toHaveBeenCalled()
  })
})
