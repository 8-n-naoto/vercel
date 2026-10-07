import 'server-only'
import { getDb } from '@/server/db/client'
import { auditLogs } from '@/server/db/schema'

export type AuditLogRow = typeof auditLogs.$inferSelect
export type AuditLogInsert = typeof auditLogs.$inferInsert

export type Db = ReturnType<typeof getDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Inserts one row. Pass a transaction to commit it together with the business change (02 5.10.2). */
export async function insertAuditLog(executor: Tx | Db, values: AuditLogInsert): Promise<void> {
  await executor.insert(auditLogs).values(values)
}

