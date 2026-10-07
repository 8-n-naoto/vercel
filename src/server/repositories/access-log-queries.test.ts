// WP-5.5 (06 9.7): listAccessLogsForFolder is two statements (page + count). A drizzle pg-proxy database records the SQL
// without a connection, so the statement count and the conditions are checked without a DB.
import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, it } from 'vitest'
import * as schema from '@/server/db/schema'
import { listAccessLogsForFolder } from './access-logs'

function recorder() {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = drizzle(
    async (sql, params) => {
      calls.push({ sql, params })
      return { rows: [] }
    },
    { schema },
  )
  return { calls, db }
}

const FOLDER = '00000000-0000-4000-8000-000000000010'
const page = { page: 3, pageSize: 50 }

describe('06 9.7 listAccessLogsForFolder SQL', () => {
  it('is two statements: the page query and count(*), with the same WHERE', async () => {
    const { calls, db } = recorder()
    const r = await listAccessLogsForFolder(db, FOLDER, {}, page)
    expect(r).toEqual({ items: [], total: 0 })
    expect(calls).toHaveLength(2)
    const [list, total] = [calls[0]!, calls[1]!]
    expect(list.sql).toMatch(/left join "app"."files" "fi"/)
    expect(list.sql).toMatch(/left join "app"."profiles" "p"/)
    expect(list.sql).toMatch(/left join "app"."share_links" "sl"/)
    expect(list.sql).toMatch(/order by "app"."access_logs"."occurred_at" desc, "app"."access_logs"."id" desc/)
    expect(list.sql).toMatch(/limit \$\d+ offset \$\d+/)
    expect(list.sql).not.toMatch(/token_hash/)
    expect(list.params).toEqual([FOLDER, 50, 100])
    expect(total.sql).toMatch(/count\(\*\)/)
    expect(total.sql).not.toMatch(/join/)
    expect(total.params).toEqual([FOLDER])
  })

  it('applies only the given filters; from is inclusive and to is exclusive', async () => {
    const from = new Date('2026-10-01T00:00:00.000Z')
    const to = new Date('2026-10-08T00:00:00.000Z')
    const { calls, db } = recorder()
    await listAccessLogsForFolder(db, FOLDER, { fileId: 'f1', result: 'denied', via: 'share_link', from, to }, { page: 1, pageSize: 50 })
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.sql).toMatch(/"app"."access_logs"."file_id" = \$\d+/)
      expect(c.sql).toMatch(/"app"."access_logs"."result" = \$\d+/)
      expect(c.sql).toMatch(/"app"."access_logs"."via" = \$\d+/)
      expect(c.sql).toMatch(/"app"."access_logs"."occurred_at" >= \$\d+/)
      expect(c.sql).toMatch(/"app"."access_logs"."occurred_at" < \$\d+/)
    }
    expect(calls[0]!.params).toEqual([FOLDER, 'f1', 'denied', 'share_link', from.toISOString(), to.toISOString(), 50])
    const bare = recorder()
    await listAccessLogsForFolder(bare.db, FOLDER, {}, { page: 1, pageSize: 50 })
    for (const c of bare.calls) expect(c.sql).not.toMatch(/"result" = |"via" = |"file_id" = |occurred_at" [<>]/)
  })
})
