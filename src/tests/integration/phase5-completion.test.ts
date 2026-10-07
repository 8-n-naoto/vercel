// 02 10 phase 4 completion conditions that no earlier file covers (WP-5.6, T-046): the viewing-window reasons (5), the 50 MB delivery (7),
// appendix A T2 (a removed member) / T7 (GET /raw has no side effect beyond consuming the ticket), and the automated halves of the two
// fault injections (docs/agents/test-plan.md, "Fault injection"). Reuses the fixtures of ticket.test.ts / view.test.ts; nothing is duplicated.
// NOT RUN in WP-5.6 (dev DB / Storage not connected). Skipped without a database; run with npm run test:integration.
// The Storage side is the in-memory fake (no egress is consumed); the real-Storage streaming check belongs to WP-5.4.
// Test fixture only: direct writes / reads of membership, files and access_logs.
// eslint-disable-next-line no-restricted-imports
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError, type AppErrorShape } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { accessLogs, files, folderMembers } from '@/server/db/schema'
import { sumMonthlyEgress } from '@/server/repositories/delivery'
import { defaultDeliveryDeps, serveTicket, type DeliveryDeps } from '@/server/services/delivery'
import { viewService } from '@/server/services/view'
import { createFakeObjects } from '@/tests/fakes/objects'
import { cleanupTestUsers, createTestUser, type TestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'
import { insertGrantedTicket, readLog, removeLogsOfFiles } from './helpers/ticket-fixture'

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

const ctxOf = (u: TestUser | null): ServiceContext => ({
  actor: u ? { userId: u.id, email: u.email, displayName: 'IT', role: u.role } : null,
  requestMeta: { ip: '203.0.113.55', userAgent: 'vitest', requestId: 'it-phase5' },
  now: new Date(),
  actionName: u ? 'it.phase5' : 'raw.get',
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
  const folderId = await createFolderRow(admin.id)
  await addMemberRow(folderId, member.id, admin.id)
  const fileId = await createFileRow(folderId, admin.id) // size_bytes = 10
  fileIds.push(fileId)
  if (Object.keys(restrictions).length) await getDb().update(files).set(restrictions).where(eq(files.id, fileId))
  const objects = createFakeObjects()
  objects.put(`${folderId}/${fileId}.html`, new TextEncoder().encode('0123456789'), 'text/html')
  const deps: DeliveryDeps = { ...defaultDeliveryDeps, objects, log: () => {} }
  return { admin, member, folderId, fileId, objects, deps }
}

// (5) the viewing-window reasons for a member; NOT_STARTED and SUSPENDED are in view.test.ts.
describe.skipIf(!dbUp)('viewing window reasons (02 10 phase 4 (5))', () => {
  it('ENDED: view_ends_at in the past -> ACCESS_DENIED ENDED with one denied row', async () => {
    const s = await setup({ viewEndsAt: new Date(Date.now() - 86_400_000) })
    expect(await shapeOf(viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId }))).toMatchObject({ code: 'ACCESS_DENIED', reason: 'ENDED' })
    expect((await logsOf(s.fileId)).map((r) => [r.result, r.denyReason, r.ticketHash])).toEqual([['denied', 'ENDED', null]])
  })

  it('FILE_EXPIRED: expires_at in the past -> ACCESS_DENIED FILE_EXPIRED with one denied row', async () => {
    const s = await setup({ expiresAt: new Date(Date.now() - 86_400_000) })
    expect(await shapeOf(viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId }))).toMatchObject({ code: 'ACCESS_DENIED', reason: 'FILE_EXPIRED' })
    expect((await logsOf(s.fileId)).map((r) => [r.result, r.denyReason, r.ticketHash])).toEqual([['denied', 'FILE_EXPIRED', null]])
  })

  it('an admin previews an ended and expired file (admin_preview, a ticket is issued)', async () => {
    const s = await setup({ viewEndsAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) })
    const r = await viewService.openAsMember(ctxOf(s.admin), { fileId: s.fileId })
    expect(r.mode).toBe('admin_preview')
    expect((await logsOf(s.fileId))[0]).toMatchObject({ result: 'granted', via: 'admin_preview' })
  })
})

// Appendix A T2: a member who was removed after fetching the iframe URL.
describe.skipIf(!dbUp)('T2: a removed member (02 appendix A, 02 10 phase 4 (8))', () => {
  it('after removal openAsMember / getMemberViewContext are NOT_FOUND (S07 / S08 are 404) and the earlier ticket is 404', async () => {
    const s = await setup()
    const issued = await viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId })
    const token = issued.viewUrl.split('/raw/')[1]!
    await getDb().delete(folderMembers).where(and(eq(folderMembers.folderId, s.folderId), eq(folderMembers.userId, s.member.id)))
    expect(await shapeOf(viewService.openAsMember(ctxOf(s.member), { fileId: s.fileId }))).toMatchObject({ code: 'NOT_FOUND' })
    expect(await shapeOf(viewService.getMemberViewContext(ctxOf(s.member), s.fileId))).toMatchObject({ code: 'NOT_FOUND' })
    expect((await serveTicket(ctxOf(null), token, 'iframe', s.deps)).status).toBe(404)
  })
})

// Appendix A T7: a GET /raw/[ticket] writes nothing except consuming its own row.
describe.skipIf(!dbUp)('T7: GET /raw has no side effect beyond consuming the ticket', () => {
  it('the access_logs row count of the folder is unchanged and only delivered_at / bytes_sent differ', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const countOf = async () => (await getDb().select({ id: accessLogs.id }).from(accessLogs).where(eq(accessLogs.folderId, s.folderId))).length
    const before = await readLog(t.id)
    const n = await countOf()
    expect((await serveTicket(ctxOf(null), t.token, 'iframe', s.deps)).status).toBe(200)
    const after = await readLog(t.id)
    expect(await countOf()).toBe(n)
    expect({ ...after, deliveredAt: null, bytesSent: null }).toEqual({ ...before, deliveredAt: null, bytesSent: null })
    expect(before?.deliveredAt).toBeNull()
    expect(after?.deliveredAt).not.toBeNull()
  })
})

// Fault injection (automated halves). The procedures with the real Storage / DB are in docs/agents/test-plan.md.
describe.skipIf(!dbUp)('fault injection 1 and 2 (automated halves)', () => {
  it('FI-1: the Storage object is missing after issue -> 502, bytes_sent = 0, delivered_at stays set, no retry', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    await s.objects.remove(`${s.folderId}/${s.fileId}.html`)
    expect((await serveTicket(ctxOf(null), t.token, 'iframe', s.deps)).status).toBe(502)
    const log = await readLog(t.id)
    expect(log?.bytesSent).toBe(0)
    expect(log?.deliveredAt).not.toBeNull()
    expect((await serveTicket(ctxOf(null), t.token, 'iframe', s.deps)).status).toBe(404)
  })

  it('FI-2: the context lookup fails right after consumption -> the call rejects (no stream), bytes_sent = 0, no retry', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const deps: DeliveryDeps = {
      ...s.deps,
      loadContext: async () => {
        throw new Error('connection terminated (injected)')
      },
    }
    await expect(serveTicket(ctxOf(null), t.token, 'iframe', deps)).rejects.toThrow('injected')
    expect((await readLog(t.id))?.bytesSent).toBe(0)
    expect((await serveTicket(ctxOf(null), t.token, 'iframe', s.deps)).status).toBe(404)
  })
})

// (7) 50 MB through /raw. The body is produced in 64 KiB chunks so the response is consumed as a stream, never as one buffer.
const FIFTY_MB = 50 * 1024 * 1024
describe.skipIf(!dbUp)('50 MB delivery (02 10 phase 4 (7))', () => {
  it('a 50 MB body is received in full through serveTicket; bytes_sent = size_bytes and the monthly egress grows by exactly that', async () => {
    const s = await setup()
    await getDb().update(files).set({ sizeBytes: FIFTY_MB }).where(eq(files.id, s.fileId))
    const chunk = new Uint8Array(65_536).fill(0x61)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= FIFTY_MB) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
        sent += chunk.length
      },
    })
    const deps: DeliveryDeps = { ...s.deps, objects: { ...s.objects, openStream: async () => ({ status: 200, body, contentLength: FIFTY_MB }) } }
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const before = await sumMonthlyEgress(getDb())
    const r = await serveTicket(ctxOf(null), t.token, 'iframe', deps)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-length')).toBe(String(FIFTY_MB))
    let received = 0
    const reader = r.body!.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
    }
    expect(received).toBe(FIFTY_MB)
    expect((await readLog(t.id))?.bytesSent).toBe(FIFTY_MB)
    expect((await sumMonthlyEgress(getDb())) - before).toBe(FIFTY_MB)
  }, 120_000)
})
