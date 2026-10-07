// 02 10 phase 5 (WP-5.5): accessLogs.listForFolder against the dev database.
// NOT RUN in WP-5.5 (T-044): the dev DB was not touched. Skipped without a database; run with npm run test:integration.
// Test fixture only: rows are written directly; access_logs rows are removed before the fixtures (FKs are RESTRICT).
// The "profile no longer exists" viewer cannot be built here (access_logs.user_id is RESTRICT); it is covered by the unit test.
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { accessLogs } from '@/server/db/schema'
import { accessLogService } from '@/server/services/access-logs'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow, createLinkRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'
import { removeLogsOfFiles } from './helpers/ticket-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const fileIds: string[] = []

afterAll(async () => {
  if (dbUp) {
    await removeLogsOfFiles(fileIds)
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

const ctxOf = (u: TestUser): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.55', userAgent: 'vitest', requestId: 'it-access-logs' },
  now: new Date(),
  actionName: 'it.accessLogs',
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

async function setup() {
  const admin = await createTestUser('admin')
  const member = await createTestUser('user')
  const outsider = await createTestUser('user')
  const folderId = await createFolderRow(admin.id)
  await addMemberRow(folderId, member.id, admin.id)
  const fileId = await createFileRow(folderId, admin.id)
  fileIds.push(fileId)
  return { admin, member, outsider, folderId, fileId }
}

function grantedRow(o: { fileId: string; folderId: string; userId: string; at: Date; deliveredAt?: Date; bytesSent?: number }) {
  return {
    fileId: o.fileId,
    folderId: o.folderId,
    via: 'member' as const,
    purpose: 'view' as const,
    userId: o.userId,
    result: 'granted' as const,
    ticketExpiresAt: new Date(o.at.getTime() + 60_000),
    occurredAt: o.at,
    ...(o.deliveredAt ? { deliveredAt: o.deliveredAt, bytesSent: o.bytesSent ?? 0 } : {}),
    ip: '203.0.113.1',
    userAgent: 'UA',
  }
}

describe.skipIf(!dbUp)('accessLogs.listForFolder (WP-5.5)', () => {
  it('returns one row per access log, newest first, with viewer and delivered mapped', async () => {
    const s = await setup()
    const t0 = Date.parse('2026-10-01T00:00:00.000Z')
    const at = (n: number) => new Date(t0 + n * 1000)
    const base = { fileId: s.fileId, folderId: s.folderId, userId: s.member.id }
    await getDb()
      .insert(accessLogs)
      .values([
        grantedRow({ ...base, at: at(1), deliveredAt: at(2), bytesSent: 10 }),
        grantedRow({ ...base, at: at(3), deliveredAt: at(4), bytesSent: 0 }),
        grantedRow({ ...base, at: at(5) }),
      ])
    const r = await accessLogService.listForFolder(ctxOf(s.admin), s.folderId, {})
    expect(r).toMatchObject({ page: 1, pageSize: 50, total: 3 })
    expect(r.items.map((i) => i.delivered)).toEqual([false, false, true])
    expect(r.items[0]).toMatchObject({
      file: { id: s.fileId },
      viewer: { kind: 'user', userId: s.member.id },
      ip: '203.0.113.1',
      userAgent: 'UA',
    })
  })

  it('a share link viewer carries label and tokenHint, never the token hash', async () => {
    const s = await setup()
    const linkId = await createLinkRow(s.fileId, s.admin.id)
    await getDb().insert(accessLogs).values({
      fileId: s.fileId,
      folderId: s.folderId,
      via: 'share_link',
      purpose: 'view',
      shareLinkId: linkId,
      result: 'denied',
      denyReason: 'LINK_EXPIRED',
    })
    const r = await accessLogService.listForFolder(ctxOf(s.admin), s.folderId, {})
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ viewer: { kind: 'share_link', linkId, tokenHint: 'abcd' }, result: 'denied', denyReason: 'LINK_EXPIRED' })
    expect(JSON.stringify(r)).not.toMatch(/token_?hash/i)
  })

  it('rows of a deleted file are still returned', async () => {
    const s = await setup()
    const deleted = await createFileRow(s.folderId, s.admin.id, { deleted: true })
    fileIds.push(deleted)
    await getDb().insert(accessLogs).values(grantedRow({ fileId: deleted, folderId: s.folderId, userId: s.member.id, at: new Date() }))
    const r = await accessLogService.listForFolder(ctxOf(s.admin), s.folderId, {})
    expect(r.items.map((i) => i.file.id)).toEqual([deleted])
    expect(r.items[0]?.file.displayName).not.toBe('')
  })

  it('filters by file, result, via and the from (inclusive) / to (exclusive) boundary', async () => {
    const s = await setup()
    const other = await createFileRow(s.folderId, s.admin.id)
    fileIds.push(other)
    const edge = new Date('2026-10-02T00:00:00.000Z')
    const base = { fileId: s.fileId, folderId: s.folderId, userId: s.member.id }
    await getDb()
      .insert(accessLogs)
      .values([
        grantedRow({ ...base, at: new Date(edge.getTime() - 1) }),
        grantedRow({ ...base, at: edge }),
        grantedRow({ ...base, fileId: other, at: edge }),
        {
          fileId: s.fileId,
          folderId: s.folderId,
          via: 'member' as const,
          purpose: 'view' as const,
          userId: s.outsider.id,
          result: 'denied' as const,
          denyReason: 'NOT_MEMBER' as const,
          occurredAt: edge,
        },
      ])
    const list = (f: Parameters<typeof accessLogService.listForFolder>[2]) => accessLogService.listForFolder(ctxOf(s.admin), s.folderId, f)
    expect((await list({ fileId: other })).total).toBe(1)
    expect((await list({ result: 'denied' })).total).toBe(1)
    expect((await list({ via: 'share_link' })).total).toBe(0)
    expect((await list({ from: edge.toISOString() })).total).toBe(3)
    expect((await list({ to: edge.toISOString() })).total).toBe(1)
    expect((await list({ from: edge.toISOString(), to: new Date(edge.getTime() + 1).toISOString() })).total).toBe(3)
  })

  it('paginates at 50 and reports the total', async () => {
    const s = await setup()
    const t0 = Date.parse('2026-10-03T00:00:00.000Z')
    const base = { fileId: s.fileId, folderId: s.folderId, userId: s.member.id }
    await getDb()
      .insert(accessLogs)
      .values(Array.from({ length: 51 }, (_, i) => grantedRow({ ...base, at: new Date(t0 + i * 1000) })))
    const p1 = await accessLogService.listForFolder(ctxOf(s.admin), s.folderId, {}, { page: 1 })
    const p2 = await accessLogService.listForFolder(ctxOf(s.admin), s.folderId, {}, { page: 2 })
    expect([p1.items.length, p2.items.length, p1.total]).toEqual([50, 1, 51])
  })

  it('a member gets FORBIDDEN, a non-member NOT_FOUND', async () => {
    const s = await setup()
    expect(await shapeOf(accessLogService.listForFolder(ctxOf(s.member), s.folderId, {}))).toMatchObject({ code: 'FORBIDDEN' })
    expect(await shapeOf(accessLogService.listForFolder(ctxOf(s.outsider), s.folderId, {}))).toMatchObject({ code: 'NOT_FOUND' })
  })
})
