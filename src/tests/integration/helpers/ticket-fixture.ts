// Fixtures for the /raw/[ticket] integration tests (WP-5.2). Needs the dev database. Rows are written directly; access_logs rows of the
// fixture files must be removed (removeLogsOfFiles) before cleanupFolderFixtures(), because the file / folder FKs are RESTRICT.
// Test fixture only: no repository function exists for these direct writes / reads.
// eslint-disable-next-line no-restricted-imports
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { accessLogs } from '@/server/db/schema'
import { insertAccessLog } from '@/server/repositories/access-logs'
import { generateToken, hashToken } from '@/server/security/tokens'

export interface TicketRow {
  token: string
  id: number
}

/** Inserts a granted, unused ticket row the way view.issue() does and returns the raw token plus the row id. */
export async function insertGrantedTicket(o: {
  fileId: string
  folderId: string
  userId: string
  via?: 'member' | 'admin_preview'
  purpose?: 'view' | 'download'
  /** Seconds from the DB's now(); default +60. Negative = already expired. */
  ttlSec?: number
}): Promise<TicketRow> {
  const token = generateToken()
  await insertAccessLog(getDb(), {
    fileId: o.fileId,
    folderId: o.folderId,
    via: o.via ?? 'member',
    purpose: o.purpose ?? 'view',
    userId: o.userId,
    shareLinkId: null,
    result: 'granted',
    ticketHash: hashToken(token),
    ticketExpiresAt: new Date(Date.now() + 3_600_000),
    ip: '203.0.113.54',
    userAgent: 'vitest',
  })
  const [row] = await getDb().select({ id: accessLogs.id }).from(accessLogs).where(eq(accessLogs.ticketHash, hashToken(token)))
  if (!row) throw new Error('fixture: ticket row not found')
  const ttl = o.ttlSec ?? 60
  await getDb()
    .update(accessLogs)
    .set({ ticketExpiresAt: sql`now() + (${ttl * 1000} * interval '1 millisecond')` })
    .where(eq(accessLogs.id, row.id))
  return { token, id: row.id }
}

/** Sets ticket_expires_at to exactly now() - 1 ms on the DB clock (TC-03). */
export async function expireTicketOneMs(id: number): Promise<void> {
  await getDb()
    .update(accessLogs)
    .set({ ticketExpiresAt: sql`now() - interval '1 millisecond'` })
    .where(eq(accessLogs.id, id))
}

/** What the daily job does after expiry (TC-06). */
export async function nullTicketHash(id: number): Promise<void> {
  await getDb().update(accessLogs).set({ ticketHash: null }).where(eq(accessLogs.id, id))
}

export async function readLog(id: number) {
  const [row] = await getDb().select().from(accessLogs).where(eq(accessLogs.id, id))
  return row
}

export async function removeLogsOfFiles(fileIds: string[]): Promise<void> {
  if (fileIds.length) await getDb().delete(accessLogs).where(inArray(accessLogs.fileId, fileIds))
}

/** EG fixtures: a delivered row with explicit delivered_at / bytes_sent (07 8.3). */
export async function insertDeliveredRow(o: { fileId: string; folderId: string; userId: string; deliveredAt: Date; bytesSent: number }): Promise<void> {
  await getDb().insert(accessLogs).values({
    fileId: o.fileId,
    folderId: o.folderId,
    via: 'member',
    purpose: 'view',
    userId: o.userId,
    result: 'granted',
    ticketHash: null,
    ticketExpiresAt: o.deliveredAt,
    deliveredAt: o.deliveredAt,
    bytesSent: o.bytesSent,
  })
}
