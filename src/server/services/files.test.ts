import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { filesService, parseFileSort, type AdminFileRow, type FileReadDeps } from './files'

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
