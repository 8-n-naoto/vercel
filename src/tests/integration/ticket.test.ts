// 07 8.2 TC-01..TC-10 (ticket consumption and /raw delivery) and 8.3 EG-01..EG-05 (monthly egress) against the dev database.
// NOT RUN in WP-5.2 (T-042): the dev database was not touched. Skipped without a database; run with npm run test:integration.
// The Storage side is the in-memory fake (src/tests/fakes/objects.ts); the database side is real (repositories + services/delivery.ts).
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { files, folderMembers } from '@/server/db/schema'
import { consumeTicket, sumMonthlyEgress } from '@/server/repositories/delivery'
import { defaultDeliveryDeps, serveTicket, type DeliveryDeps } from '@/server/services/delivery'
import { createFakeObjects } from '@/tests/fakes/objects'
import { cleanupTestUsers, createTestUser } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'
import { expireTicketOneMs, insertDeliveredRow, insertGrantedTicket, nullTicketHash, readLog, removeLogsOfFiles } from './helpers/ticket-fixture'
// Test fixture only: removing a membership / changing a file directly.
// eslint-disable-next-line no-restricted-imports
import { and, eq } from 'drizzle-orm'

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

const ctx = (): ServiceContext => ({
  actor: null,
  requestMeta: { ip: '203.0.113.54', userAgent: 'vitest', requestId: 'it-ticket' },
  now: new Date(),
  actionName: 'raw.get',
})

async function setup() {
  const admin = await createTestUser('admin')
  const member = await createTestUser('user')
  const folderId = await createFolderRow(admin.id)
  await addMemberRow(folderId, member.id, admin.id)
  const fileId = await createFileRow(folderId, admin.id) // size_bytes = 10, download_allowed false
  fileIds.push(fileId)
  await getDb().update(files).set({ downloadAllowed: true }).where(eq(files.id, fileId))
  const objects = createFakeObjects()
  objects.put(`${folderId}/${fileId}.html`, new TextEncoder().encode('0123456789'), 'text/html')
  const deps: DeliveryDeps = { ...defaultDeliveryDeps, objects, log: () => {} }
  return { admin, member, folderId, fileId, objects, deps }
}

describe.skipIf(!dbUp)('ticket consumption (07 8.2 TC-01..TC-06)', () => {
  it('TC-01: granted, unused, +60 s -> 1 row; delivered_at set, bytes_sent = files.size_bytes', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const { hashToken } = await import('@/server/security/tokens')
    const row = await consumeTicket(getDb(), hashToken(t.token))
    expect(row).toMatchObject({ id: t.id, fileId: s.fileId, folderId: s.folderId, via: 'member', purpose: 'view', shareLinkId: null, userId: s.member.id })
    const log = await readLog(t.id)
    expect(log?.deliveredAt).not.toBeNull()
    expect(log?.bytesSent).toBe(10)
  })

  it('TC-02: the same ticket again -> 0 rows (404)', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const { hashToken } = await import('@/server/security/tokens')
    expect(await consumeTicket(getDb(), hashToken(t.token))).toBeDefined()
    expect(await consumeTicket(getDb(), hashToken(t.token))).toBeUndefined()
    expect((await serveTicket(ctx(), t.token, 'iframe', s.deps)).status).toBe(404)
  })

  it('TC-03: expired by 1 ms -> 0 rows', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    await expireTicketOneMs(t.id)
    const { hashToken } = await import('@/server/security/tokens')
    expect(await consumeTicket(getDb(), hashToken(t.token))).toBeUndefined()
    expect((await readLog(t.id))?.deliveredAt).toBeNull()
  })

  it('TC-04: a denied row (ticket_hash NULL) cannot be consumed with any hash', async () => {
    const s = await setup()
    const { insertAccessLog } = await import('@/server/repositories/access-logs')
    await insertAccessLog(getDb(), { fileId: s.fileId, folderId: s.folderId, via: 'member', purpose: 'view', userId: s.member.id, result: 'denied', denyReason: 'SUSPENDED' })
    expect(await consumeTicket(getDb(), 'f'.repeat(64))).toBeUndefined()
    const { generateToken, hashToken } = await import('@/server/security/tokens')
    expect(await consumeTicket(getDb(), hashToken(generateToken()))).toBeUndefined()
  })

  it('TC-05: two connections consume at once -> exactly one gets the row', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const { hashToken } = await import('@/server/security/tokens')
    const results = await Promise.all([consumeTicket(getDb(), hashToken(t.token)), consumeTicket(getDb(), hashToken(t.token))])
    expect(results.filter((r) => r !== undefined)).toHaveLength(1)
  })

  it('TC-06: after the daily job nulled ticket_hash, the original token consumes nothing', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    await nullTicketHash(t.id)
    const { hashToken } = await import('@/server/security/tokens')
    expect(await consumeTicket(getDb(), hashToken(t.token))).toBeUndefined()
  })
})

describe.skipIf(!dbUp)('/raw delivery (07 8.2 TC-07..TC-10)', () => {
  it('TC-07: removed from the folder after issue -> 404, bytes_sent = 0, delivered_at stays', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    await getDb().delete(folderMembers).where(and(eq(folderMembers.folderId, s.folderId), eq(folderMembers.userId, s.member.id)))
    const r = await serveTicket(ctx(), t.token, 'iframe', s.deps)
    expect(r.status).toBe(404)
    const log = await readLog(t.id)
    expect(log?.bytesSent).toBe(0)
    expect(log?.deliveredAt).not.toBeNull()
    expect((await serveTicket(ctx(), t.token, 'iframe', s.deps)).status).toBe(404) // used: cannot be retried
  })

  it('TC-08: view ticket with Sec-Fetch-Dest: document -> 403, bytes_sent = 0', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const r = await serveTicket(ctx(), t.token, 'document', s.deps)
    expect(r.status).toBe(403)
    expect((await readLog(t.id))?.bytesSent).toBe(0)
  })

  it('TC-09: download ticket with Sec-Fetch-Dest: document -> 200 with B-3 headers, bytes_sent = size', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id, purpose: 'download', ttlSec: 600 })
    const r = await serveTicket(ctx(), t.token, 'document', s.deps)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(r.headers.get('content-disposition')).toContain('attachment;')
    expect(await r.text()).toBe('0123456789')
    expect((await readLog(t.id))?.bytesSent).toBe(10)
  })

  it('TC-10: Storage answers 500 -> 502, bytes_sent = 0', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const deps: DeliveryDeps = { ...s.deps, objects: { openStream: async () => ({ status: 500, body: new ReadableStream<Uint8Array>(), contentLength: null }) } }
    const r = await serveTicket(ctx(), t.token, 'iframe', deps)
    expect(r.status).toBe(502)
    expect((await readLog(t.id))?.bytesSent).toBe(0)
  })

  it('view happy path: 200 with B-2 headers, the file body, and bytes_sent = size', async () => {
    const s = await setup()
    const t = await insertGrantedTicket({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id })
    const r = await serveTicket(ctx(), t.token, 'iframe', s.deps)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(await r.text()).toBe('0123456789')
    expect((await readLog(t.id))?.bytesSent).toBe(10)
  })
})

// 07 8.3. The database clock is real, so the month boundaries are computed from the current UTC month and every case compares the
// difference of sumMonthlyEgress before / after inserting its own rows (other rows in the dev database do not matter).
describe.skipIf(!dbUp)('monthly egress (07 8.3 EG-01..EG-05)', () => {
  const monthStart = () => {
    const n = new Date()
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))
  }
  async function delta(deliveredAt: Date, bytesSent: number, times = 1): Promise<number> {
    const s = await setup()
    const before = await sumMonthlyEgress(getDb())
    for (let i = 0; i < times; i++) await insertDeliveredRow({ fileId: s.fileId, folderId: s.folderId, userId: s.member.id, deliveredAt, bytesSent })
    return (await sumMonthlyEgress(getDb())) - before
  }

  it('EG-01: delivered exactly at the start of the UTC month is included', async () => {
    expect(await delta(monthStart(), 100)).toBe(100)
  })
  it('EG-02: 1 ms before the start of the month is not included', async () => {
    expect(await delta(new Date(monthStart().getTime() - 1), 100)).toBe(0)
  })
  it('EG-03: a failed delivery (bytes_sent = 0) adds 0', async () => {
    expect(await delta(new Date(), 0)).toBe(0)
  })
  it('EG-04: the sum is a number (0 when there are no rows, never NULL)', async () => {
    const v = await sumMonthlyEgress(getDb())
    expect(typeof v).toBe('number')
    expect(v).toBeGreaterThanOrEqual(0)
  })
  it('EG-05: 3,000,000,000 x 2 rows -> 6,000,000,000 (bigint, below 2^53)', async () => {
    expect(await delta(new Date(), 3_000_000_000, 2)).toBe(6_000_000_000)
  })
})
