// WP-4.3: the SQL of the daily job steps 2-4 (07 10.2), recorded through drizzle's pg-proxy without a connection.
import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, it } from 'vitest'
import * as schema from '@/server/db/schema'
import { listUnpurgedDeletedFiles, lockAbandonedPendingFiles, lockExpiredActiveFiles, markFilesDeletedBySystem } from './files'

const NOW = new Date('2026-10-11T18:00:00.000Z')

describe('step SQL', () => {
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

  it('step 2 select: pending, upload_expires_at < $now, ordered, limit, FOR UPDATE SKIP LOCKED, no now()', async () => {
    const { calls, db } = recorder()
    await lockAbandonedPendingFiles(db, NOW, 500)
    const q = calls[0]?.sql ?? ''
    expect(q).toContain('for update skip locked')
    expect(q).toContain('limit $')
    expect(q).toContain('"upload_expires_at" <')
    expect(q).toContain('order by "app"."files"."upload_expires_at"')
    expect(q).not.toMatch(/\bnow\(\)/i)
    expect(calls[0]?.params).toEqual(expect.arrayContaining(['pending', NOW.toISOString(), 500]))
  })

  it('step 3 select: active, expires_at < $now - days (parameters), FOR UPDATE SKIP LOCKED, folders not locked, no now()', async () => {
    const { calls, db } = recorder()
    await lockExpiredActiveFiles(db, NOW, 30, 500)
    const q = calls[0]?.sql ?? ''
    expect(q).toContain('for update skip locked')
    expect(q).toContain('make_interval(days =>')
    expect(q).not.toContain('"folders"')
    expect(q).not.toMatch(/\bnow\(\)/i)
    expect(calls[0]?.params).toEqual(expect.arrayContaining(['active', NOW.toISOString(), 30, 500]))
  })

  it('step 4 select: deleted and purged_at IS NULL, ordered by deleted_at, limit, no lock, no now()', async () => {
    const { calls, db } = recorder()
    await listUnpurgedDeletedFiles(db, 500)
    const q = calls[0]?.sql ?? ''
    expect(q).toContain('"purged_at" is null')
    expect(q).toContain('order by "app"."files"."deleted_at"')
    expect(q).toContain('limit $')
    expect(q).not.toContain('for update')
    expect(q).not.toMatch(/\bnow\(\)/i)
  })

  it('markFilesDeletedBySystem is one UPDATE over the ids with deleted_by NULL and no now(); empty input issues nothing', async () => {
    const { calls, db } = recorder()
    await markFilesDeletedBySystem(db, [], 'expired', NOW)
    expect(calls).toHaveLength(0)
    await markFilesDeletedBySystem(db, ['a', 'b'], 'upload_abandoned', NOW)
    expect(calls).toHaveLength(1)
    const q = calls[0]?.sql ?? ''
    expect(q).toContain('"deleted_by" = $')
    expect(q).not.toMatch(/\bnow\(\)/i)
    expect(calls[0]?.params).toEqual(expect.arrayContaining(['deleted', 'upload_abandoned', NOW.toISOString(), null]))
  })
})
