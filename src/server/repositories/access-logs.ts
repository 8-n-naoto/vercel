import 'server-only'
import { accessLogs } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import { notImplemented } from './not-implemented'

export type AccessLogRow = typeof accessLogs.$inferSelect

export async function listAccessLogsForFolder(folderId: string): Promise<AccessLogRow[]> {
  return notImplemented('accessLogs.listAccessLogsForFolder', [folderId])
}

export async function findAccessLogByTicketHash(ticketHash: string): Promise<AccessLogRow | undefined> {
  return notImplemented('accessLogs.findAccessLogByTicketHash', [ticketHash])
}

export type AccessLogInsert = typeof accessLogs.$inferInsert
type Executor = Tx | Db

/** Inserts one access log row (denied or granted). The caller sets ticket columns only for granted rows. */
export async function insertAccessLog(executor: Executor, values: AccessLogInsert): Promise<void> {
  await executor.insert(accessLogs).values(values)
}
