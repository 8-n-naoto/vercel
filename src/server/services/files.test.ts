import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import type { MemberFileDetail } from '@/lib/dto'
import type { FileRow } from '@/server/repositories/files'
import { filesService, parseFileSort, type AdminFileRow, type FileDetailDeps, type FileReadDeps, type UploadContextDeps } from './files'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const now = new Date('2026-10-08T00:00:00.000Z')
const ctx: ServiceContext = {
  actor: { userId: 'u1', email: 'u1@example.com', displayName: 'U1', role: 'user' },
  requestMeta: { ip: null, userAgent: null, requestId: 'r1' },
  now,
  actionName: 'files.test',
}

const base: AdminFileRow = {
  id: 'f',
  folderId: FOLDER,
  displayName: 'a.html',
  sizeBytes: 10,
  suspended: false,
  viewStartsAt: null,
  viewEndsAt: null,
  expiresAt: null,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  activeShareLinkCount: 2,
}

function deps(access: 'admin' | 'member', rows: AdminFileRow[] = []): FileReadDeps {
  return {
    assertFolder: vi.fn(async () => ({ access })),
    listAdminRows: vi.fn(async () => rows),
    listMemberRows: vi.fn(async () => rows.map((r) => ({ id: r.id, folderId: r.folderId, displayName: r.displayName, sizeBytes: r.sizeBytes, updatedAt: r.updatedAt }))),
  }
}

describe('parseFileSort (06 9.4)', () => {
  it.each([
    ['name_asc', 'name_asc'],
    ['size_desc', 'size_desc'],
    ['updated_desc', 'updated_desc'],
    ['bogus', 'updated_desc'],
    [undefined, 'updated_desc'],
    [['size_desc', 'name_asc'], 'size_desc'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(parseFileSort(input as string | string[] | undefined)).toBe(expected)
  })
})

describe('files.listInFolder (06 9.4)', () => {
  it('admin: displayState is derived on the app side, link count and viewStartsAt are included', async () => {
    const d = deps('admin', [
      base,
      { ...base, id: 'g', suspended: true },
      { ...base, id: 'h', viewStartsAt: new Date('2026-10-10T00:00:00Z') },
      { ...base, id: 'i', expiresAt: now },
    ])
    const r = await filesService.listInFolder(ctx, FOLDER, 'name_asc', d)
    expect(r.access).toBe('admin')
    if (r.access !== 'admin') return
    expect(r.files.map((f) => f.displayState)).toEqual(['public', 'suspended', 'not_started', 'expired'])
    expect(r.files[0]).toMatchObject({ activeShareLinkCount: 2, viewStartsAt: null, updatedAt: '2026-10-01T00:00:00.000Z' })
    expect(r.files[2]?.viewStartsAt).toBe('2026-10-10T00:00:00.000Z')
    expect(d.listAdminRows).toHaveBeenCalledWith(FOLDER, 'name_asc', now)
  })

  it('member: only the public summary, with no restriction or link fields', async () => {
    const r = await filesService.listInFolder(ctx, FOLDER, 'updated_desc', deps('member', [base]))
    expect(r).toEqual({ access: 'member', files: [{ id: 'f', folderId: FOLDER, displayName: 'a.html', sizeBytes: 10, updatedAt: '2026-10-01T00:00:00.000Z' }] })
  })

  it('a non-uuid folder id is NOT_FOUND without a query', async () => {
    const d = deps('admin')
    await expect(filesService.listInFolder(ctx, 'abc', 'updated_desc', d)).rejects.toBeInstanceOf(AppError)
    expect(d.assertFolder).not.toHaveBeenCalled()
  })

  it('an invalid sort value that slipped through falls back to updated_desc', async () => {
    const d = deps('member')
    // @ts-expect-error the value is not a FileSort on purpose
    await filesService.listInFolder(ctx, FOLDER, 'bogus', d)
    expect(d.listMemberRows).toHaveBeenCalledWith(FOLDER, 'updated_desc', now)
  })
})

const FILE = '00000000-0000-4000-8000-000000000020'
const MB = 1_048_576
const adminCtx: ServiceContext = { ...ctx, actor: { userId: 'a1', email: 'a1@example.com', displayName: 'A1', role: 'admin' } }

function fileRow(over: Partial<FileRow> = {}): FileRow {
  return {
    id: FILE,
    folderId: FOLDER,
    uploadedBy: 'a1',
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
    downloadAllowed: true,
    uploadExpiresAt: null,
    activatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    purgedAt: null,
    createdAt: now,
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    ...over,
  }
}
const detailDeps = (access: 'admin' | 'member', file: FileRow): FileDetailDeps => ({
  load: vi.fn(async () => ({ access, file, folderName: 'Docs', uploaderName: access === 'admin' ? 'Alice' : null })),
})

describe('files.getDetail (06 9.9)', () => {
  it('admin: the full detail including the uploader and restrictions', async () => {
    const r = await filesService.getDetail(adminCtx, FILE, detailDeps('admin', fileRow({ suspended: true })))
    expect(r.access).toBe('admin')
    if (r.access !== 'admin') return
    expect(r.file).toMatchObject({ displayState: 'suspended', folderName: 'Docs', uploadedBy: { id: 'a1', displayName: 'Alice' }, charset: 'utf-8' })
    expect(r.file.restrictions.suspended).toBe(true)
  })

  it('admin: a pending file is NOT_FOUND', async () => {
    await expect(filesService.getDetail(adminCtx, FILE, detailDeps('admin', fileRow({ status: 'pending' })))).rejects.toBeInstanceOf(AppError)
  })

  it('member: a public file yields the simple DTO without e-mail, uploader, restrictions or storage fields', async () => {
    const r = await filesService.getDetail(ctx, FILE, detailDeps('member', fileRow()))
    expect(r).toEqual({
      access: 'member',
      file: {
        id: FILE,
        folderId: FOLDER,
        folderName: 'Docs',
        displayName: 'doc',
        sizeBytes: 100,
        updatedAt: '2026-10-02T00:00:00.000Z',
        downloadAllowed: true,
      },
    })
    const keys = r.access === 'member' ? Object.keys(r.file).sort() : []
    expect(keys).toEqual(['displayName', 'downloadAllowed', 'folderId', 'folderName', 'id', 'sizeBytes', 'updatedAt'])
    expect(JSON.stringify(r)).not.toMatch(/email|storage|uploadedBy|restrictions|originalFilename/i)
  })

  it.each([
    ['suspended', { suspended: true }],
    ['not started', { viewStartsAt: new Date('2026-10-09T00:00:00Z') }],
    ['view ended', { viewEndsAt: now }],
    ['expired', { expiresAt: now }],
    ['pending', { status: 'pending' as const }],
  ])('member: a %s file is NOT_FOUND (the state is not revealed)', async (_n, over) => {
    const e = await filesService.getDetail(ctx, FILE, detailDeps('member', fileRow(over))).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(AppError)
    expect((e as AppError).shape.code).toBe('NOT_FOUND')
  })

  it('a non-uuid id is NOT_FOUND without a query', async () => {
    const d = detailDeps('admin', fileRow())
    await expect(filesService.getDetail(adminCtx, 'abc', d)).rejects.toBeInstanceOf(AppError)
    expect(d.load).not.toHaveBeenCalled()
  })

  it('the member DTO type has no e-mail (type-level)', () => {
    expectTypeOf<MemberFileDetail>().not.toHaveProperty('email')
    expectTypeOf<MemberFileDetail>().not.toHaveProperty('uploadedBy')
    expectTypeOf<MemberFileDetail>().not.toHaveProperty('restrictions')
  })
})

describe('files.getUploadContext (06 9.8)', () => {
  const limits = { maxFileBytes: 50 * MB, userLimitBytes: 900 * MB, totalLimitBytes: 1000 * MB }
  it('returns the folder, the limits and the used bytes', async () => {
    const d: UploadContextDeps = {
      load: vi.fn(async () => ({ folder: { id: FOLDER, name: 'Docs' }, userUsed: 10, totalUsed: 30 })),
      limits: () => limits,
    }
    expect(await filesService.getUploadContext(adminCtx, FOLDER, d)).toEqual({
      folder: { id: FOLDER, name: 'Docs' },
      maxFileSizeBytes: 50 * MB,
      userQuota: { usedBytes: 10, limitBytes: 900 * MB },
      totalQuota: { usedBytes: 30, limitBytes: 1000 * MB },
    })
  })

  it('a non-uuid folder id is NOT_FOUND without a query; an authz error from load propagates', async () => {
    const load = vi.fn(async () => {
      throw new AppError({ code: 'FORBIDDEN', message: 'x' })
    })
    const d: UploadContextDeps = { load, limits: () => limits }
    await expect(filesService.getUploadContext(ctx, 'abc', d)).rejects.toBeInstanceOf(AppError)
    expect(load).not.toHaveBeenCalled()
    await expect(filesService.getUploadContext(ctx, FOLDER, d)).rejects.toMatchObject({ shape: { code: 'FORBIDDEN' } })
  })
})
