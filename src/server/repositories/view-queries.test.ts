import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import * as schema from '@/server/db/schema'
import { insertAccessLog } from './access-logs'
import type { Db } from './audit-logs'
import { findFileForTicket } from './view'

// Statements are captured by the drizzle logger before they are sent; the send fails (nothing listens) and is ignored. No database is touched.
async function capture(run: (tx: Db) => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const client = postgres('postgres://u:p@127.0.0.1:1/none', { max: 1, connect_timeout: 1 })
  const db = drizzle(client, { schema, logger: { logQuery: (q) => void seen.push(q) } })
  await run(db).catch(() => undefined)
  await client.end({ timeout: 0 })
  return seen
}

describe('06 8.4 single-statement query', () => {
  it('findFileForTicket is one statement: files JOIN folders LEFT JOIN folder_members, no lock, no status filter', async () => {
    const q = await capture((tx) => findFileForTicket(tx, 'fi', 'u'))
    expect(q).toHaveLength(1)
    expect(q[0]).toMatch(/inner join "app"."folders" "f"/)
    expect(q[0]).toMatch(/left join "app"."folder_members" "fm"/)
    expect(q[0]).not.toMatch(/ for /)
    expect(q[0]).not.toMatch(/where .*"status"/)
  })
  it('insertAccessLog is one INSERT', async () => {
    const q = await capture((tx) =>
      insertAccessLog(tx, { fileId: 'f', folderId: 'g', via: 'member', purpose: 'view', result: 'denied', denyReason: 'NOT_MEMBER' }),
    )
    expect(q).toHaveLength(1)
    expect(q[0]).toMatch(/^insert into "app"."access_logs"/)
  })
})
