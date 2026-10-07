// 02 10 phase 2 completion conditions for folders and members (06 6.1-6.5, 9.2-9.6, 9.16; 07 DS-13) against the dev database.
// NOT RUN in WP-3.3: the dev DB was unreachable. Skipped without a database; run with npm run test:integration.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

// Test fixture cleanup only: the production code never deletes these rows.
// eslint-disable-next-line no-restricted-imports
import { and, eq, inArray } from 'drizzle-orm'
import { fileDisplayState } from '@/lib/display-state'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { auditLogs, files, folderMembers, folders, shareLinks } from '@/server/db/schema'
import { filePublicSql } from '@/server/repositories/files'
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

const createdFolders: string[] = []
const gridFolders: string[] = []

afterAll(async () => {
  if (dbUp) {
    const db = getDb()
    const ids = [...createdFolders, ...gridFolders]
    if (ids.length) {
      const fileIds = (await db.select({ id: files.id }).from(files).where(inArray(files.folderId, ids))).map((r) => r.id)
      if (fileIds.length) await db.delete(shareLinks).where(inArray(shareLinks.fileId, fileIds))
      await db.delete(files).where(inArray(files.folderId, ids))
      await db.delete(folderMembers).where(inArray(folderMembers.folderId, ids))
      await db.delete(auditLogs).where(inArray(auditLogs.folderId, ids))
      await db.delete(folders).where(inArray(folders.id, ids))
    }
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

const ctxOf = (u: TestUser, now = new Date()): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.40', userAgent: 'vitest', requestId: 'it-folders' },
  now,
  actionName: 'it.folders',
})
async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape.code
    throw e
  }
}

describe.skipIf(!dbUp)('folders and members (02 10 phase 2)', () => {
  it('a non-member gets NOT_FOUND by URL, a member cannot use manage reads, the member DTO has no e-mail', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const outsider = await createTestUser('user')
    const { folderId } = await foldersService.create(ctxOf(admin), { name: `it-${randomUUID().slice(0, 8)}`, description: '' })
    createdFolders.push(folderId)
    await membersService.add(ctxOf(admin), { folderId, userIds: [member.id] })

    expect(await codeOf(foldersService.getDetail(ctxOf(outsider), folderId))).toBe('NOT_FOUND')
    expect(await codeOf(membersService.list(ctxOf(outsider), folderId))).toBe('NOT_FOUND')
    expect(await codeOf(filesService.listInFolder(ctxOf(outsider), folderId, 'updated_desc'))).toBe('NOT_FOUND')
    expect((await foldersService.getDetail(ctxOf(member), folderId)).access).toBe('member')
    expect(await codeOf(membersService.listCandidates(ctxOf(member), folderId))).toBe('FORBIDDEN')

    const list = await membersService.list(ctxOf(member), folderId)
    expect(list.access).toBe('member')
    expect(JSON.stringify(list)).not.toContain(member.email)
    const adminList = await membersService.list(ctxOf(admin), folderId)
    expect(adminList.access === 'admin' && adminList.members[0]?.email).toBe(member.email)

    expect(await codeOf(foldersService.getDetail(ctxOf(outsider), 'not-a-uuid'))).toBe('NOT_FOUND')
    expect(await codeOf(foldersService.listFolders(ctxOf(member)))).toBe('FORBIDDEN')
  })

  it('members.add rejects an admin target; skipped counts existing members; members.remove takes effect immediately', async () => {
    const admin = await createTestUser('admin')
    const other = await createTestUser('admin')
    const member = await createTestUser('user')
    const { folderId } = await foldersService.create(ctxOf(admin), { name: `it-${randomUUID().slice(0, 8)}`, description: '' })
    createdFolders.push(folderId)

    expect(await codeOf(membersService.add(ctxOf(admin), { folderId, userIds: [other.id] }))).toBe('VALIDATION_FAILED')
    expect(await membersService.add(ctxOf(admin), { folderId, userIds: [member.id] })).toEqual({ added: 1, skipped: 0 })
    expect(await membersService.add(ctxOf(admin), { folderId, userIds: [member.id] })).toEqual({ added: 0, skipped: 1 })
    expect(await foldersService.getDetail(ctxOf(member), folderId)).toMatchObject({ id: folderId })

    await membersService.remove(ctxOf(admin), { folderId, userId: member.id })
    expect(await codeOf(foldersService.getDetail(ctxOf(member), folderId))).toBe('NOT_FOUND')
    expect(await codeOf(membersService.remove(ctxOf(admin), { folderId, userId: member.id }))).toBe('NOT_FOUND')
    const rows = await getDb().select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.folderId, folderId)))
    expect(rows.map((r) => r.action).sort()).toEqual(['folder.created', 'member.added', 'member.removed'])
  })

  it('listVisible shows a member only own folders and counts public files only; admin sees all', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const mine = await createFolderRow(admin.id)
    const notMine = await createFolderRow(admin.id)
    createdFolders.push(mine, notMine)
    await addMemberRow(mine, member.id, admin.id)
    await createFileRow(mine, admin.id)
    const hidden = await createFileRow(mine, admin.id)
    await getDb().update(files).set({ suspended: true }).where(eq(files.id, hidden))

    const forMember = await foldersService.listVisible(ctxOf(member))
    expect(forMember.map((f) => f.id)).toEqual([mine])
    expect(forMember[0]?.fileCount).toBe(1)
    const forAdmin = await foldersService.listVisible(ctxOf(admin))
    expect(forAdmin.find((f) => f.id === mine)?.fileCount).toBe(2)
    expect(forAdmin.some((f) => f.id === notMine)).toBe(true)
    const adminFiles = await filesService.listInFolder(ctxOf(admin), mine, 'name_asc')
    expect(adminFiles.access === 'admin' && adminFiles.files.map((f) => f.displayState).sort()).toEqual(['public', 'suspended'])
    const memberFiles = await filesService.listInFolder(ctxOf(member), mine, 'name_asc')
    expect(memberFiles.files).toHaveLength(1)
    expect((await foldersService.listFolders(ctxOf(admin))).some((r) => r.id === mine)).toBe(true)
  })

  it('folders.update / delete: name mismatch is rejected, delete reports 3 values and hides the folder', async () => {
    const admin = await createTestUser('admin')
    const name = `it-${randomUUID().slice(0, 8)}`
    const { folderId } = await foldersService.create(ctxOf(admin), { name, description: '' })
    createdFolders.push(folderId)
    await foldersService.update(ctxOf(admin), { folderId, name: `${name}-2`, description: 'x' })
    expect(await codeOf(foldersService.remove(ctxOf(admin), { folderId, confirmName: name }))).toBe('VALIDATION_FAILED')
    const fileId = await createFileRow(folderId, admin.id)
    const out = await foldersService.remove(ctxOf(admin), { folderId, confirmName: `${name}-2` })
    expect(out.deletedFiles).toBe(1)
    expect(out.revokedLinks).toBe(0)
    expect(await codeOf(foldersService.getDetail(ctxOf(admin), folderId))).toBe('NOT_FOUND')
    const [row] = await getDb().select({ status: files.status }).from(files).where(eq(files.id, fileId))
    expect(row?.status).toBe('deleted')
  })

  // 07 DS-13: FILE_PUBLIC_SQL selects exactly the rows with fileDisplayState = 'public' (128 combinations).
  it('DS-13: FILE_PUBLIC_SQL agrees with fileDisplayState on every combination', async () => {
    const admin = await createTestUser('admin')
    const folderId = await createFolderRow(admin.id)
    gridFolders.push(folderId)
    const now = new Date()
    const offsets = [null, -1, 0, 1] as const
    const at = (o: number | null): Date | null => (o === null ? null : new Date(now.getTime() + o))
    const rows = [] as (typeof files.$inferInsert)[]
    for (const suspended of [false, true])
      for (const e of offsets)
        for (const s of offsets)
          for (const v of offsets) {
            const id = randomUUID()
            rows.push({
              id,
              folderId,
              uploadedBy: admin.id,
              displayName: id,
              originalFilename: 'g.html',
              storagePath: `${folderId}/${id}.html`,
              sizeBytes: 1,
              status: 'active',
              activatedAt: now,
              suspended,
              expiresAt: at(e),
              viewStartsAt: at(s),
              viewEndsAt: at(v),
            })
          }
    expect(rows).toHaveLength(128)
    // view_starts_at < view_ends_at is a CHECK; combinations that violate it cannot exist, so they are dropped from both sides.
    const valid = rows.filter((r) => !r.viewStartsAt || !r.viewEndsAt || r.viewStartsAt < r.viewEndsAt)
    await getDb().insert(files).values(valid)
    const viaSql = new Set((await getDb().select({ id: files.id }).from(files).where(and(eq(files.folderId, folderId), filePublicSql(now)))).map((r) => r.id))
    const viaApp = new Set(valid.filter((r) => fileDisplayState({ suspended: r.suspended ?? false, viewStartsAt: r.viewStartsAt ?? null, viewEndsAt: r.viewEndsAt ?? null, expiresAt: r.expiresAt ?? null }, now) === 'public').map((r) => r.id))
    expect(viaSql).toEqual(viaApp)
  })
})
