import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { createFakeObjects } from '@/tests/fakes/objects'
import { foldersService, type FolderDeps, type FolderTx } from './folders'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const ctxOf = (role: 'admin' | 'user'): ServiceContext => ({
  actor: { userId: 'u1', email: 'u1@example.com', displayName: 'U1', role },
  requestMeta: { ip: null, userAgent: null, requestId: 'r1' },
  now: new Date('2026-10-08T00:00:00.000Z'),
  actionName: 'folders.test',
})
const admin = ctxOf('admin')

async function codeOf(p: Promise<unknown>): Promise<AppError['shape'] | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape
    throw e
  }
}

function setup(over: { files?: { id: string; storagePath: string }[]; links?: number; folder?: { name: string; description: string } } = {}) {
  const calls: string[] = []
  const objects = createFakeObjects()
  const files = over.files ?? []
  for (const f of files) objects.put(f.storagePath, new Uint8Array([1]), 'text/html')
  const folder = { id: FOLDER, ...(over.folder ?? { name: 'Docs', description: 'd' }) }
  const tx: FolderTx = {
    assertManage: vi.fn(async (_id, lock) => {
      calls.push(`assert:${lock}`)
      return folder
    }),
    insertFolder: vi.fn(async () => {
      calls.push('insert')
      return FOLDER
    }),
    updateFolder: vi.fn(async () => void calls.push('update')),
    lockFiles: vi.fn(async () => {
      calls.push('lockFiles')
      return files
    }),
    markFilesDeleted: vi.fn(async () => void calls.push('markDeleted')),
    revokeLinks: vi.fn(async () => {
      calls.push('revoke')
      return over.links ?? 0
    }),
    softDelete: vi.fn(async () => void calls.push('softDelete')),
    auditCreated: vi.fn(async () => void calls.push('audit:created')),
    auditUpdated: vi.fn(async () => void calls.push('audit:updated')),
    auditDeleted: vi.fn(async () => void calls.push('audit:deleted')),
  }
  const markPurged = vi.fn<FolderDeps['markPurged']>(async () => void calls.push('markPurged'))
  const log = vi.fn()
  const deps: FolderDeps = {
    transaction: async (_ctx, fn) => {
      const r = await fn(tx)
      calls.push('commit')
      return r
    },
    objects: () => objects,
    markPurged,
    listVisibleRows: vi.fn(async () => []),
    listAdminRows: vi.fn(async () => []),
    assertView: vi.fn(async () => ({ folder: { ...folder, createdAt: new Date(0), updatedAt: new Date(0) }, access: 'member' as const })),
    log,
  }
  return { deps, tx, calls, objects, markPurged, log }
}

describe('folders.create (06 6.1)', () => {
  it('inserts, writes folder.created and does not add the creator as a member', async () => {
    const s = setup()
    await expect(foldersService.create(admin, { name: 'Docs', description: '' }, s.deps)).resolves.toEqual({ folderId: FOLDER })
    expect(s.calls).toEqual(['insert', 'audit:created', 'commit'])
  })
})

describe('folders.update (06 6.2)', () => {
  it('locks the folder FOR UPDATE, updates and audits', async () => {
    const s = setup()
    await foldersService.update(admin, { folderId: FOLDER, name: 'New', description: 'd' }, s.deps)
    expect(s.calls).toEqual(['assert:update', 'update', 'audit:updated', 'commit'])
    expect(s.tx.auditUpdated).toHaveBeenCalledWith(FOLDER, { name: 'Docs', description: 'd' }, { name: 'New', description: 'd' })
  })
  it('writes nothing when the values are unchanged', async () => {
    const s = setup()
    await foldersService.update(admin, { folderId: FOLDER, name: 'Docs', description: 'd' }, s.deps)
    expect(s.calls).toEqual(['assert:update', 'commit'])
  })
})

describe('folders.delete (06 6.3)', () => {
  const files = [
    { id: 'f1', storagePath: `${FOLDER}/f1.html` },
    { id: 'f2', storagePath: `${FOLDER}/f2.html` },
  ]

  it('name mismatch is VALIDATION_FAILED with fieldErrors.confirmName and changes nothing', async () => {
    const s = setup({ files })
    const e = await codeOf(foldersService.remove(admin, { folderId: FOLDER, confirmName: 'docs' }, s.deps)) // case-sensitive
    expect(e?.code).toBe('VALIDATION_FAILED')
    expect(e?.fieldErrors?.['confirmName']).toEqual(['フォルダ名が一致しません'])
    expect(s.calls).toEqual(['assert:update'])
    expect(s.objects.has(files[0]?.storagePath ?? '')).toBe(true)
  })

  it('returns the three counts, follows the 06 order, and purges after the commit', async () => {
    const s = setup({ files, links: 3 })
    const out = await foldersService.remove(admin, { folderId: FOLDER, confirmName: 'Docs' }, s.deps)
    expect(out).toEqual({ deletedFiles: 2, revokedLinks: 3, purgeFailed: 0 })
    expect(s.calls).toEqual(['assert:update', 'lockFiles', 'markDeleted', 'revoke', 'softDelete', 'audit:deleted', 'commit', 'markPurged'])
    expect(s.tx.auditDeleted).toHaveBeenCalledWith(FOLDER, 'Docs', 2, 3)
    expect(s.markPurged).toHaveBeenCalledWith(['f1', 'f2'], expect.any(Date))
    expect(s.objects.has(files[0]?.storagePath ?? '')).toBe(false)
  })

  it('an empty folder returns zeros and does not mark anything purged', async () => {
    const s = setup()
    const out = await foldersService.remove(admin, { folderId: FOLDER, confirmName: 'Docs' }, s.deps)
    expect(out).toEqual({ deletedFiles: 0, revokedLinks: 0, purgeFailed: 0 })
    expect(s.markPurged).not.toHaveBeenCalled()
  })

  it('a failing removeMany is counted in purgeFailed, the folder stays deleted and purged_at stays NULL', async () => {
    const s = setup({ files })
    s.objects.failNext('removeMany')
    const out = await foldersService.remove(admin, { folderId: FOLDER, confirmName: 'Docs' }, s.deps)
    expect(out).toEqual({ deletedFiles: 2, revokedLinks: 0, purgeFailed: 2 })
    expect(s.markPurged).not.toHaveBeenCalled()
    expect(s.objects.has(files[0]?.storagePath ?? '')).toBe(true)
  })

  it('a thrown Storage error is also counted and logged by name only', async () => {
    const s = setup({ files })
    s.deps.objects = () => ({
      ...s.objects,
      removeMany: async () => {
        throw new Error('https://secret.example/signed?token=abc')
      },
    })
    const out = await foldersService.remove(admin, { folderId: FOLDER, confirmName: 'Docs' }, s.deps)
    expect(out.purgeFailed).toBe(2)
    expect(JSON.stringify(s.log.mock.calls)).not.toContain('secret')
  })

  it('removes in chunks of 100 and marks only the removed ones', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `f${i}`, storagePath: `${FOLDER}/f${i}.html` }))
    const s = setup({ files: many })
    const removeMany = vi.fn(async (paths: string[]) => ({ removed: paths.slice(0, paths.length - 1), failed: paths.slice(-1) }))
    s.deps.objects = () => ({ ...s.objects, removeMany })
    const out = await foldersService.remove(admin, { folderId: FOLDER, confirmName: 'Docs' }, s.deps)
    expect(removeMany.mock.calls.map((c) => c[0].length)).toEqual([100, 50])
    expect(out).toEqual({ deletedFiles: 150, revokedLinks: 0, purgeFailed: 2 })
    expect(s.markPurged).toHaveBeenCalledTimes(2)
    expect(s.markPurged.mock.calls[0]?.[0]).toHaveLength(99)
  })
})

describe('RSC reads', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  it('listVisible: admin passes actorId null, member passes the own id; dates become ISO strings', async () => {
    vi.mocked(s.deps.listVisibleRows).mockResolvedValue([{ id: 'a', name: 'A', description: '', updatedAt: new Date('2026-10-01T00:00:00Z'), fileCount: 2 }])
    expect(await foldersService.listVisible(admin, s.deps)).toEqual([{ id: 'a', name: 'A', description: '', updatedAt: '2026-10-01T00:00:00.000Z', fileCount: 2 }])
    expect(s.deps.listVisibleRows).toHaveBeenLastCalledWith({ actorId: null, now: admin.now })
    await foldersService.listVisible(ctxOf('user'), s.deps)
    expect(s.deps.listVisibleRows).toHaveBeenLastCalledWith({ actorId: 'u1', now: admin.now })
  })

  it('getDetail: a non-uuid id is NOT_FOUND without touching the database', async () => {
    expect((await codeOf(foldersService.getDetail(admin, 'abc', s.deps)))?.code).toBe('NOT_FOUND')
    expect(s.deps.assertView).not.toHaveBeenCalled()
  })

  it('getDetail returns access from assertFolderRole', async () => {
    const d = await foldersService.getDetail(ctxOf('user'), FOLDER, s.deps)
    expect(d).toMatchObject({ id: FOLDER, access: 'member', createdAt: '1970-01-01T00:00:00.000Z' })
  })

  it('listFolders: a non-admin is FORBIDDEN and no query runs', async () => {
    expect((await codeOf(foldersService.listFolders(ctxOf('user'), s.deps)))?.code).toBe('FORBIDDEN')
    expect(s.deps.listAdminRows).not.toHaveBeenCalled()
  })

  it('listFolders maps createdBy and numbers', async () => {
    vi.mocked(s.deps.listAdminRows).mockResolvedValue([
      { id: 'a', name: 'A', updatedAt: new Date(0), createdById: 'c', createdByName: 'Cee', memberCount: 1, fileCount: 2, usedBytes: 30, activeShareLinkCount: 4 },
    ])
    expect(await foldersService.listFolders(admin, s.deps)).toEqual([
      { id: 'a', name: 'A', memberCount: 1, fileCount: 2, usedBytes: 30, activeShareLinkCount: 4, createdBy: { id: 'c', displayName: 'Cee' }, updatedAt: '1970-01-01T00:00:00.000Z' },
    ])
  })
})
