import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import * as schema from '@/server/db/schema'
import type { Db } from './audit-logs'
import { consumeTicket, loadDeliveryContext, markNotDelivered, sumMonthlyEgress } from './delivery'

// Statements are captured by the drizzle logger before they are sent; the send fails (nothing listens) and is ignored. No database is touched.
async function capture(run: (tx: Db) => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const client = postgres('postgres://u:p@127.0.0.1:1/none', { max: 1, connect_timeout: 1 })
  const db = drizzle(client, { schema, logger: { logQuery: (q) => void seen.push(q) } })
  await run(db).catch(() => undefined)
  await client.end({ timeout: 0 })
  return seen
}

const HASH = 'a'.repeat(64)

describe('07 8.1 ticket consumption', () => {
  it('consumeTicket is one UPDATE with the four conditions, delivered_at = now(), bytes_sent from files.size_bytes and the 7 RETURNING columns', async () => {
    const q = await capture((db) => consumeTicket(db, HASH))
    expect(q).toHaveLength(1)
    const sql = q[0] ?? ''
    expect(sql).toMatch(/^update "app"."access_logs" set "delivered_at" = now\(\), "bytes_sent" = \(select "app"."files"."size_bytes" from "app"."files" where "app"."files"."id" = "app"."access_logs"."file_id"\)/)
    expect(sql).toMatch(/where \("app"."access_logs"."ticket_hash" = \$1 and "app"."access_logs"."result" = \$2 and "app"."access_logs"."delivered_at" is null and "app"."access_logs"."ticket_expires_at" > now\(\)\)/)
    expect(sql).toMatch(/returning "id", "file_id", "folder_id", "via", "purpose", "share_link_id", "user_id"$/)
  })
  it('markNotDelivered sets bytes_sent only (delivered_at stays)', async () => {
    const q = await capture((db) => markNotDelivered(db, 5))
    expect(q).toHaveLength(1)
    expect(q[0]).toMatch(/^update "app"."access_logs" set "bytes_sent" = \$1 where "app"."access_logs"."id" = \$2$/)
  })
})

describe('06 10.1 step 7 re-evaluation read', () => {
  it('loadDeliveryContext is one SELECT over files / folders / share_links / profiles / folder_members, no lock', async () => {
    const q = await capture((db) => loadDeliveryContext(db, { fileId: 'f', userId: 'u', shareLinkId: 's' }))
    expect(q).toHaveLength(1)
    const sql = q[0] ?? ''
    expect(sql).toMatch(/from "app"."files" inner join "app"."folders"/)
    expect(sql).toMatch(/left join "app"."share_links" on \("app"."share_links"."id" = \$\d and "app"."share_links"."file_id" = "app"."files"."id"\)/)
    expect(sql).toMatch(/left join "app"."profiles"/)
    expect(sql).toMatch(/left join "app"."folder_members"/)
    expect(sql).not.toMatch(/ for /)
  })
  it('without a user or a link the joins are disabled (still one statement)', async () => {
    const q = await capture((db) => loadDeliveryContext(db, { fileId: 'f', userId: null, shareLinkId: null }))
    expect(q).toHaveLength(1)
    expect(q[0]).toMatch(/left join "app"."share_links" on false/)
    expect(q[0]).toMatch(/left join "app"."profiles" on false/)
  })
})

describe('07 8.3 monthly egress', () => {
  it('sumMonthlyEgress: COALESCE(SUM(bytes_sent), 0) over delivered_at >= date_trunc(month, now(), UTC)', async () => {
    const q = await capture((db) => sumMonthlyEgress(db))
    expect(q).toHaveLength(1)
    expect(q[0]).toContain(`coalesce(sum("bytes_sent"), 0)::bigint`)
    expect(q[0]).toContain(`"delivered_at" >= date_trunc('month', now(), 'UTC')`)
  })
})
