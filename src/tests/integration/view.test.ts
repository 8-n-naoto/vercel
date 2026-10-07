// 02 10 phase 4 (WP-5.1 share): view.openAsMember / requestMemberDownload / getMemberViewContext against the dev database.
// NOT RUN in WP-5.1 (T-041): the dev DB was not touched. Skipped without a database; run with npm run test:integration.
// Test fixture only: rows are written and read back directly; access_logs rows are removed before the fixtures (FKs are RESTRICT).
// eslint-disable-next-line no-restricted-imports
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { accessLogs, files } from '@/server/db/schema'
import { hashToken } from '@/server/security/tokens'
import { viewService } from '@/server/services/view'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const fileIds: string[] = []

afterAll(async () => {
  if (dbUp) {
    if (fileIds.length) await getDb().delete(accessLogs).where(inArray(accessLogs.fileId, fileIds))
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

const ctxOf = (u: TestUser, now = new Date()): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT', role: u.role },
  requestMeta: { ip: '203.0.113.53', userAgent: 'vitest', requestId: 'it-view' },
  now,
  actionName: 'it.view',
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
const logsOf = (fileId: string) => getDb().select().from(accessLogs).where(eq(accessLogs.fileId, fileId))

async function setup(restrictions: Partial<typeof files.$inferInsert> = {}) {
  const admin = await createTestUser('admin')
  const member = await createTestUser('user')
  const outsider = await createTestUser('user')
  const folderId = await createFolderRow(admin.id)
  await addMemberRow(folderId, member.id, admin.id)
  const fileId = await createFileRow(folderId, admin.id)
  fileIds.push(fileId)
  if (Object.keys(restrictions).length) await getDb().update(files).set(restrictions).where(eq(files.id, fileId))
  return { admin, member, outsider, folderId, fileId }
}

describe.skipIf(!dbUp)('member viewing (WP-5.1)', () => {
  it('AZ-04: a member of a public file gets a ticket; the DB holds ticket_hash only', async () => {
    const s = await setup({ downloadAllowed: true })
    const r = await viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId })
    expect(r).toMatchObject({ canDownload: true, mode: 'member' })
    const token = r.viewUrl.split('/raw/')[1]!
    expect(token).toHaveLength(43)
    const rows = await logsOf(s.fileId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ result: 'granted', via: 'member', purpose: 'view', userId: s.member.id, ticketHash: hashToken(token) })
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(rows[0]!.deliveredAt).toBeNull()
  })

  it('AZ-03: a non-member gets NOT_FOUND view.not_found and one denied NOT_MEMBER row', async () => {
    const s = await setup()
    const e = await shapeOf(viewService.openAsMember(ctxOf(s.outsider), { fileId: s.fileId }))
    expect(e).toMatchObject({ code: 'NOT_FOUND', message: 'このファイルは存在しないか、閲覧できません' })
    const rows = await logsOf(s.fileId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ result: 'denied', denyReason: 'NOT_MEMBER', ticketHash: null })
  })

  it('a suspended file: ACCESS_DENIED SUSPENDED for a member with one denied row', async () => {
    const s = await setup({ suspended: true })
    expect(await shapeOf(viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId }))).toMatchObject({ code: 'ACCESS_DENIED', reason: 'SUSPENDED' })
    const rows = await logsOf(s.fileId)
    expect(rows.map((r) => [r.result, r.denyReason])).toEqual([['denied', 'SUSPENDED']])
  })

  it('NOT_STARTED carries startsAt', async () => {
    const startsAt = new Date(Date.now() + 86_400_000)
    const s = await setup({ viewStartsAt: startsAt })
    const e = await shapeOf(viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId }))
    expect(e).toMatchObject({ code: 'ACCESS_DENIED', reason: 'NOT_STARTED', startsAt: startsAt.toISOString() })
  })

  it('an admin previews a suspended file as admin_preview', async () => {
    const s = await setup({ suspended: true })
    const r = await viewService.openAsMember(ctxOf(s.admin), { fileId: s.fileId })
    expect(r.mode).toBe('admin_preview')
    const rows = await logsOf(s.fileId)
    expect(rows[0]).toMatchObject({ result: 'granted', via: 'admin_preview', userId: s.admin.id })
  })

  it('requestMemberDownload: downloads off -> ACCESS_DENIED and no ticket row; on -> a download ticket', async () => {
    const off = await setup({ downloadAllowed: false })
    expect(await shapeOf(viewService.requestMemberDownload(ctxOf(off.member), { fileId: off.fileId }))).toMatchObject({ code: 'ACCESS_DENIED', reason: 'DOWNLOAD_NOT_ALLOWED' })
    const offRows = await logsOf(off.fileId)
    expect(offRows).toHaveLength(1)
    expect(offRows[0]).toMatchObject({ purpose: 'download', result: 'denied', ticketHash: null })
    const on = await setup({ downloadAllowed: true })
    const now = new Date()
    const r = await viewService.requestMemberDownload(ctxOf(on.member, now), { fileId: on.fileId })
    const [row] = await getDb().select().from(accessLogs).where(and(eq(accessLogs.fileId, on.fileId), eq(accessLogs.purpose, 'download')))
    expect(row?.ticketHash).toBe(hashToken(r.downloadUrl.split('/raw/')[1]!))
    expect(row?.ticketExpiresAt?.toISOString()).toBe(r.expiresAt)
  })

  it('getMemberViewContext writes no access log and does not hide a suspended file from a member (D-018 (j))', async () => {
    const s = await setup({ suspended: true })
    const m = await viewService.getMemberViewContext(ctxOf(s.member), s.fileId)
    expect(m).toMatchObject({ mode: 'member', previewNotice: null })
    const a = await viewService.getMemberViewContext(ctxOf(s.admin), s.fileId)
    expect(a).toMatchObject({ mode: 'admin_preview', previewNotice: 'suspended' })
    expect(await logsOf(s.fileId)).toHaveLength(0)
    expect(await shapeOf(viewService.getMemberViewContext(ctxOf(s.outsider), s.fileId))).toMatchObject({ code: 'NOT_FOUND' })
  })
})
