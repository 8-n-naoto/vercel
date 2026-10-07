import 'server-only'
import type { auditLogs } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type AuditLogRow = typeof auditLogs.$inferSelect

export async function listAuditLogs(): Promise<AuditLogRow[]> {
  return notImplemented('auditLogs.listAuditLogs', [])
}
