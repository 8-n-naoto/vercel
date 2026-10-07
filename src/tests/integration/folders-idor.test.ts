// 02 10 phase 2 completion (1) / (2) / (6), 02 9.2.2 (IDOR) and 07 13.3 AZ-10, against the dev database.
// The point of the IDOR cases: another user's folder, an unknown uuid, a deleted folder and a non-uuid id must give the SAME error
// (code, message, fields), so that the response cannot be used to learn whether a folder exists.
// NOT RUN in WP-3.5: the dev DB was unreachable. Skipped without a database; run with npm run test:integration.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, pingDb } from '@/server/db/client'
import { filesService } from '@/server/services/files'
import { foldersService } from '@/server/services/folders'
import { membersService } from '@/server/services/members'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

afterAll(async () => {
  if (dbUp) {
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

const ctxOf = (u: TestUser): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.41', userAgent: 'vitest', requestId: 'it-folders-idor' },
  now: new Date(),
  actionName: 'it.folders-idor',
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
const key = (s: AppErrorShape | null): string => JSON.stringify({ ...s, requestId: undefined })

describe.skipIf(!dbUp)('IDOR on folders and members (02 9.2.2, phase 2 (1) / (2) / (6), AZ-10)', () => {
  it('IDOR-1 / phase 2 (1): another folder, an unknown uuid, a deleted folder and a non-uuid id give one identical NOT_FOUND on every read', async () => {
    const admin = await createTestUser('admin')
    const outsider = await createTestUser('user')
    const otherFolder = await createFolderRow(admin.id)
    const deletedFolder = await createFolderRow(admin.id, { deleted: true })
    const ids = [otherFolder, randomUUID(), deletedFolder, 'not-a-uuid']
    const reads: [string, (id: string) => Promise<unknown>][] = [
      ['getDetail', (id) => foldersService.getDetail(ctxOf(outsider), id)],
      ['members.list', (id) => membersService.list(ctxOf(outsider), id)],
      ['listInFolder', (id) => filesService.listInFolder(ctxOf(outsider), id, 'updated_desc')],
    ]
    for (const [name, read] of reads) {
      const shapes = await Promise.all(ids.map((id) => shapeOf(read(id))))
      for (const s of shapes) expect(s, name).toMatchObject({ code: 'NOT_FOUND' })
      expect(new Set(shapes.map(key)).size, `${name}: the shape must not depend on the id`).toBe(1)
    }
  })

  it('IDOR-2: a member of another folder gets NOT_FOUND; admin Actions on an unknown or deleted folder give one identical NOT_FOUND', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const mine = await createFolderRow(admin.id)
    const other = await createFolderRow(admin.id)
    await addMemberRow(mine, member.id, admin.id)
    expect(await shapeOf(foldersService.getDetail(ctxOf(member), other))).toMatchObject({ code: 'NOT_FOUND' })

    const deleted = await createFolderRow(admin.id, { deleted: true })
    const targets = [randomUUID(), deleted]
    const ops: [string, (id: string) => Promise<unknown>][] = [
      ['folders.update', (id) => foldersService.update(ctxOf(admin), { folderId: id, name: 'x', description: '' })],
      ['folders.delete', (id) => foldersService.remove(ctxOf(admin), { folderId: id, confirmName: 'x' })],
      ['members.add', (id) => membersService.add(ctxOf(admin), { folderId: id, userIds: [member.id] })],
      ['members.remove', (id) => membersService.remove(ctxOf(admin), { folderId: id, userId: member.id })],
      ['listCandidates', (id) => membersService.listCandidates(ctxOf(admin), id)],
    ]
    for (const [name, op] of ops) {
      const shapes = await Promise.all(targets.map((id) => shapeOf(op(id))))
      for (const s of shapes) expect(s, name).toMatchObject({ code: 'NOT_FOUND' })
      expect(new Set(shapes.map(key)).size, `${name}: unknown and deleted look the same`).toBe(1)
    }
  })

  it('AZ-10 / phase 2 (2): manage reads are FORBIDDEN for a member of the folder, NOT_FOUND for an outsider (the page turns both into notFound())', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const outsider = await createTestUser('user')
    const folderId = await createFolderRow(admin.id)
    await addMemberRow(folderId, member.id, admin.id)
    expect(await shapeOf(membersService.listCandidates(ctxOf(member), folderId))).toMatchObject({ code: 'FORBIDDEN' })
    expect(await shapeOf(foldersService.listFolders(ctxOf(member)))).toMatchObject({ code: 'FORBIDDEN' })
    expect(await shapeOf(membersService.listCandidates(ctxOf(outsider), folderId))).toMatchObject({ code: 'NOT_FOUND' })
    expect(await shapeOf(foldersService.listFolders(ctxOf(outsider)))).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('phase 2 (6): what a member receives for S04 / S05 (list, detail, members, files) contains no e-mail address', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const peer = await createTestUser('user')
    const folderId = await createFolderRow(admin.id)
    await addMemberRow(folderId, member.id, admin.id)
    await addMemberRow(folderId, peer.id, admin.id)
    await createFileRow(folderId, admin.id)
    const received = {
      visible: await foldersService.listVisible(ctxOf(member)),
      detail: await foldersService.getDetail(ctxOf(member), folderId),
      members: await membersService.list(ctxOf(member), folderId),
      files: await filesService.listInFolder(ctxOf(member), folderId, 'name_asc'),
    }
    const json = JSON.stringify(received)
    expect(json).not.toContain('@')
    for (const u of [admin, member, peer]) expect(json).not.toContain(u.email)
    // The admin view of the same folder does carry them (guards against a test that passes only because the data is empty).
    expect(JSON.stringify(await membersService.list(ctxOf(admin), folderId))).toContain(peer.email)
  })
})
