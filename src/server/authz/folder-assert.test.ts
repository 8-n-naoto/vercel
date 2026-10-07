import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import type { Tx } from '@/server/repositories/audit-logs'
import type { UserRole } from '@/lib/domain'

const repo = vi.hoisted(() => ({ folder: vi.fn(), file: vi.fn(), link: vi.fn() }))
vi.mock('@/server/repositories/folders', () => ({ findFolderWithMembership: repo.folder }))
vi.mock('@/server/repositories/files', () => ({ findFileWithFolderAndMembership: repo.file }))
vi.mock('@/server/repositories/share-links', () => ({ findShareLinkWithFileAndFolder: repo.link }))

import { assertFileRole, assertFolderRole, assertShareLinkRole } from './folder'

const tx = {} as Tx
const ctxOf = (role: UserRole | null): ServiceContext => ({
  actor: role ? { userId: 'u1', email: 'u@example.com', displayName: 'U', role } : null,
  requestMeta: { ip: null, userAgent: null, requestId: 'req-1' },
  now: new Date('2026-10-08T00:00:00Z'),
  actionName: 'test',
})
const folder = (deletedAt: Date | null = null) => ({ id: 'f1', name: 'F', deletedAt })
const file = { id: 'fi1', folderId: 'f1' }
const link = { id: 'l1', fileId: 'fi1' }

async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return { code: e.shape.code, message: e.shape.message }
    throw e
  }
}

beforeEach(() => vi.resetAllMocks())

describe('assertFolderRole', () => {
  it('passes the actor id and lock mode to the single query and returns the folder', async () => {
    repo.folder.mockResolvedValue({ folder: folder(), isMember: true })
    const r = await assertFolderRole(ctxOf('user'), tx, 'f1', 'view', { lock: 'share' })
    expect(r).toEqual({ folder: folder(), access: 'member' })
    expect(repo.folder).toHaveBeenCalledWith(tx, 'f1', 'u1', 'share')
  })
  it('defaults to no lock', async () => {
    repo.folder.mockResolvedValue({ folder: folder(), isMember: true })
    await assertFolderRole(ctxOf('user'), tx, 'f1', 'view')
    expect(repo.folder).toHaveBeenCalledWith(tx, 'f1', 'u1', 'none')
  })
  it('admin without membership is ok for manage', async () => {
    repo.folder.mockResolvedValue({ folder: folder(), isMember: false })
    expect((await assertFolderRole(ctxOf('admin'), tx, 'f1', 'manage')).access).toBe('admin')
  })
  it('non-member is NOT_FOUND (common.not_found)', async () => {
    repo.folder.mockResolvedValue({ folder: folder(), isMember: false })
    expect(await codeOf(assertFolderRole(ctxOf('user'), tx, 'f1', 'view'))).toEqual({ code: 'NOT_FOUND', message: '対象が見つかりません。画面を再読み込みしてください' })
  })
  it('member needing manage is FORBIDDEN (common.forbidden)', async () => {
    repo.folder.mockResolvedValue({ folder: folder(), isMember: true })
    expect(await codeOf(assertFolderRole(ctxOf('user'), tx, 'f1', 'manage'))).toEqual({ code: 'FORBIDDEN', message: 'この操作を行う権限がありません' })
  })
  it('missing and deleted folders are NOT_FOUND even for admin', async () => {
    repo.folder.mockResolvedValueOnce(undefined)
    expect((await codeOf(assertFolderRole(ctxOf('admin'), tx, 'f1', 'view')))?.code).toBe('NOT_FOUND')
    repo.folder.mockResolvedValueOnce({ folder: folder(new Date()), isMember: true })
    expect((await codeOf(assertFolderRole(ctxOf('admin'), tx, 'f1', 'view')))?.code).toBe('NOT_FOUND')
  })
  it('a missing actor is INTERNAL and runs no query', async () => {
    expect((await codeOf(assertFolderRole(ctxOf(null), tx, 'f1', 'view')))?.code).toBe('INTERNAL')
    expect(repo.folder).not.toHaveBeenCalled()
  })
})

describe('assertFileRole', () => {
  it('returns file, folder and access; passes lock options', async () => {
    repo.file.mockResolvedValue({ file, folder: folder(), isMember: true })
    const r = await assertFileRole(ctxOf('user'), tx, 'fi1', 'view', { lock: 'share', lockFile: true })
    expect(r).toEqual({ file, folder: folder(), access: 'member' })
    expect(repo.file).toHaveBeenCalledWith(tx, 'fi1', 'u1', 'share', true)
  })
  it('defaults to no lock', async () => {
    repo.file.mockResolvedValue({ file, folder: folder(), isMember: true })
    await assertFileRole(ctxOf('user'), tx, 'fi1', 'view')
    expect(repo.file).toHaveBeenCalledWith(tx, 'fi1', 'u1', 'none', false)
  })
  it('deleted file (query returns nothing) is NOT_FOUND even for admin', async () => {
    repo.file.mockResolvedValue(undefined)
    expect((await codeOf(assertFileRole(ctxOf('admin'), tx, 'fi1', 'view')))?.code).toBe('NOT_FOUND')
  })
  it('non-member NOT_FOUND, member manage FORBIDDEN, deleted folder NOT_FOUND', async () => {
    repo.file.mockResolvedValueOnce({ file, folder: folder(), isMember: false })
    expect((await codeOf(assertFileRole(ctxOf('user'), tx, 'fi1', 'view')))?.code).toBe('NOT_FOUND')
    repo.file.mockResolvedValueOnce({ file, folder: folder(), isMember: true })
    expect((await codeOf(assertFileRole(ctxOf('user'), tx, 'fi1', 'manage')))?.code).toBe('FORBIDDEN')
    repo.file.mockResolvedValueOnce({ file, folder: folder(new Date()), isMember: true })
    expect((await codeOf(assertFileRole(ctxOf('user'), tx, 'fi1', 'view')))?.code).toBe('NOT_FOUND')
  })
})

describe('assertShareLinkRole', () => {
  it('admin gets link, file and folder; lockLink is passed', async () => {
    repo.link.mockResolvedValue({ link, file, folder: folder() })
    expect(await assertShareLinkRole(ctxOf('admin'), tx, 'l1', { lockLink: true })).toEqual({ link, file, folder: folder() })
    expect(repo.link).toHaveBeenCalledWith(tx, 'l1', true)
  })
  it('non-admin is FORBIDDEN without querying', async () => {
    expect(await codeOf(assertShareLinkRole(ctxOf('user'), tx, 'l1'))).toEqual({ code: 'FORBIDDEN', message: 'この操作を行う権限がありません' })
    expect(repo.link).not.toHaveBeenCalled()
  })
  it('unknown / deleted-file / deleted-folder link is NOT_FOUND', async () => {
    repo.link.mockResolvedValue(undefined)
    expect((await codeOf(assertShareLinkRole(ctxOf('admin'), tx, 'l1')))?.code).toBe('NOT_FOUND')
  })
})
