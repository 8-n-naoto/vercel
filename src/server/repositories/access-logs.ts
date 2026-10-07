import 'server-only'
import type { accessLogs } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type AccessLogRow = typeof accessLogs.$inferSelect

export async function listAccessLogsForFolder(folderId: string): Promise<AccessLogRow[]> {
  return notImplemented('accessLogs.listAccessLogsForFolder', [folderId])
}

export async function findAccessLogByTicketHash(ticketHash: string): Promise<AccessLogRow | undefined> {
  return notImplemented('accessLogs.findAccessLogByTicketHash', [ticketHash])
}
