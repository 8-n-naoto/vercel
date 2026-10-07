// 06 3.4 assertFolderRole / assertFileRole / assertShareLinkRole against the dev database (07 13.1 integration side, 07 14).
// NOT RUN in WP-3.1: the dev DB was unreachable. Skipped without a database; run with npm run test:integration.
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFileRole, assertFolderRole, assertShareLinkRole } from '@/server/authz/folder'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import type { Tx } from '@/server/repositories/audit-logs'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow, createLinkRow } from './helpers/folder-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

afterAll(async () => {
  if (dbUp) {
    await cleanupFolderFixtures()
    await cleanupTestUsers()
  }
  await closeDb()
})

const ctxOf = (u: TestUser): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.30', userAgent: 'vitest', requestId: 'it-folder-authz' },
  now: new Date(),
  actionName: 'it.folderAuthz',
})
const inTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => getDb().transaction(fn)
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape.code
    throw e
  }
}

describe.skipIf(!dbUp)('folder authorization (06 3.4)', () => {
  let cache: ReturnType<typeof build> | undefined
  async function build() {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const outsider = await createTestUser('user')
    const folder = await createFolderRow(admin.id)
    await addMemberRow(folder, member.id, admin.id)
    const deletedFolder = await createFolderRow(admin.id, { deleted: true })
    await addMemberRow(deletedFolder, member.id, admin.id)
    const file = await createFileRow(folder, admin.id)
    const deletedFile = await createFileRow(folder, admin.id, { deleted: true })
    const fileInDeletedFolder = await createFileRow(deletedFolder, admin.id)
    const link = await createLinkRow(file, admin.id)
    const linkOfDeletedFile = await createLinkRow(deletedFile, admin.id)
    const linkInDeletedFolder = await createLinkRow(fileInDeletedFolder, admin.id)
    return { admin, member, outsider, folder, deletedFolder, file, deletedFile, fileInDeletedFolder, link, linkOfDeletedFile, linkInDeletedFolder }
  }
  const fixtures = () => (cache ??= build())

  it('member: view ok, manage FORBIDDEN', async () => {
    const s = await fixtures()
    const r = await inTx((tx) => assertFolderRole(ctxOf(s.member), tx, s.folder, 'view'))
    expect(r.access).toBe('member')
    expect(r.folder.id).toBe(s.folder)
    expect(await codeOf(inTx((tx) => assertFolderRole(ctxOf(s.member), tx, s.folder, 'manage')))).toBe('FORBIDDEN')
  })
  it('non-member: NOT_FOUND for view and manage; unknown id NOT_FOUND', async () => {
    const s = await fixtures()
    expect(await codeOf(inTx((tx) => assertFolderRole(ctxOf(s.outsider), tx, s.folder, 'view')))).toBe('NOT_FOUND')
    expect(await codeOf(inTx((tx) => assertFolderRole(ctxOf(s.outsider), tx, s.folder, 'manage')))).toBe('NOT_FOUND')
    expect(await codeOf(inTx((tx) => assertFolderRole(ctxOf(s.admin), tx, UNKNOWN_ID, 'view')))).toBe('NOT_FOUND')
  })
  it('admin without membership: ok for manage', async () => {
    const s = await fixtures()
    const r = await inTx((tx) => assertFolderRole(ctxOf(s.admin), tx, s.folder, 'manage'))
    expect(r.access).toBe('admin')
  })
  it('deleted folder is NOT_FOUND for member and admin', async () => {
    const s = await fixtures()
    expect(await codeOf(inTx((tx) => assertFolderRole(ctxOf(s.member), tx, s.deletedFolder, 'view')))).toBe('NOT_FOUND')
    expect(await codeOf(inTx((tx) => assertFolderRole(ctxOf(s.admin), tx, s.deletedFolder, 'view')))).toBe('NOT_FOUND')
  })
  it('every lock mode runs (none / share / update)', async () => {
    const s = await fixtures()
    for (const lock of ['none', 'share', 'update'] as const) {
      const r = await inTx((tx) => assertFolderRole(ctxOf(s.member), tx, s.folder, 'view', { lock }))
      expect(r.folder.id).toBe(s.folder)
    }
  })

  it('file: member view ok with file and folder; manage FORBIDDEN; non-member NOT_FOUND', async () => {
    const s = await fixtures()
    const r = await inTx((tx) => assertFileRole(ctxOf(s.member), tx, s.file, 'view'))
    expect(r.file.id).toBe(s.file)
    expect(r.folder.id).toBe(s.folder)
    expect(await codeOf(inTx((tx) => assertFileRole(ctxOf(s.member), tx, s.file, 'manage')))).toBe('FORBIDDEN')
    expect(await codeOf(inTx((tx) => assertFileRole(ctxOf(s.outsider), tx, s.file, 'view')))).toBe('NOT_FOUND')
  })
  it('file: status deleted and files of a deleted folder are NOT_FOUND even for admin', async () => {
    const s = await fixtures()
    expect(await codeOf(inTx((tx) => assertFileRole(ctxOf(s.admin), tx, s.deletedFile, 'view')))).toBe('NOT_FOUND')
    expect(await codeOf(inTx((tx) => assertFileRole(ctxOf(s.admin), tx, s.fileInDeletedFolder, 'view')))).toBe('NOT_FOUND')
  })
  it('file: every lock combination runs', async () => {
    const s = await fixtures()
    for (const lock of ['none', 'share', 'update'] as const) {
      for (const lockFile of [false, true]) {
        const r = await inTx((tx) => assertFileRole(ctxOf(s.admin), tx, s.file, 'manage', { lock, lockFile }))
        expect(r.access).toBe('admin')
      }
    }
  })

  it('share link: admin gets link, file and folder (with and without lockLink)', async () => {
    const s = await fixtures()
    for (const lockLink of [false, true]) {
      const r = await inTx((tx) => assertShareLinkRole(ctxOf(s.admin), tx, s.link, { lockLink }))
      expect([r.link.id, r.file.id, r.folder.id]).toEqual([s.link, s.file, s.folder])
    }
  })
  it('share link: non-admin (even a member) is FORBIDDEN', async () => {
    const s = await fixtures()
    expect(await codeOf(inTx((tx) => assertShareLinkRole(ctxOf(s.member), tx, s.link)))).toBe('FORBIDDEN')
  })
  it('share link: deleted file / deleted folder / unknown id is NOT_FOUND for admin', async () => {
    const s = await fixtures()
    expect(await codeOf(inTx((tx) => assertShareLinkRole(ctxOf(s.admin), tx, s.linkOfDeletedFile)))).toBe('NOT_FOUND')
    expect(await codeOf(inTx((tx) => assertShareLinkRole(ctxOf(s.admin), tx, s.linkInDeletedFolder)))).toBe('NOT_FOUND')
    expect(await codeOf(inTx((tx) => assertShareLinkRole(ctxOf(s.admin), tx, UNKNOWN_ID)))).toBe('NOT_FOUND')
  })
})
