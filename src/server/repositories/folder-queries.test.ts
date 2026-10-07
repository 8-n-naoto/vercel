// WP-3.3: the read queries are one statement each (06 9.2 / 9.4 / 9.5 / 9.6 / 9.16). A drizzle pg-proxy database records the SQL
// without a connection, so the statement count and the conditions are checked without a DB. The row-level parity of
// FILE_PUBLIC_SQL with fileDisplayState (DS-13) is in integration/folders.test.ts.
import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, it } from 'vitest'
import * as schema from '@/server/db/schema'
import { listActiveFilesForAdmin, listPublicFilesForMember } from './files'
import { listAdminFolderRows, listVisibleFolderRows } from './folders'
import { listMemberRows } from './folder-members'
import { listMemberCandidates } from './profiles'

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
const now = new Date('2026-10-08T00:00:00.000Z')
const ID = '00000000-0000-4000-8000-0000000000aa'

describe('folder read queries issue one statement each', () => {
  it('listVisibleFolderRows (member) filters by membership and counts only public files', async () => {
    const { calls, db } = recorder()
    await listVisibleFolderRows(db, { actorId: ID, now })
    expect(calls).toHaveLength(1)
    const q = calls[0]?.sql ?? ''
    expect(q).toContain('exists (select 1 from "app"."folder_members"')
    expect(q).toContain('filter (where')
    expect(q).toContain('"suspended"') // FILE_PUBLIC_SQL is in the count condition
    expect(q).toContain('group by')
    expect(q).toContain('order by "app"."folders"."name"')
    expect(calls[0]?.params).toContain(ID)
    expect(calls[0]?.params.filter((p) => p === now.toISOString()).length).toBe(3) // expires_at, view_starts_at, view_ends_at
  })

  it('listVisibleFolderRows (admin) has no membership condition and no file condition', async () => {
    const { calls, db } = recorder()
    await listVisibleFolderRows(db, { actorId: null, now })
    expect(calls).toHaveLength(1)
    const q = calls[0]?.sql ?? ''
    expect(q).not.toContain('folder_members')
    expect(q).toContain('filter (where true)')
  })

  it('listAdminFolderRows is one statement', async () => {
    const { calls, db } = recorder()
    await listAdminFolderRows(db, now)
    expect(calls).toHaveLength(1)
  })

  it('listMemberRows / listMemberCandidates are one statement; members never see disabled users', async () => {
    const a = recorder()
    await listMemberRows(a.db, ID, true)
    expect(a.calls).toHaveLength(1)
    expect(a.calls[0]?.sql).not.toContain('"disabled_at" is null')
    const b = recorder()
    await listMemberRows(b.db, ID, false)
    expect(b.calls).toHaveLength(1)
    expect(b.calls[0]?.sql).toContain('"disabled_at" is null')
    const c = recorder()
    await listMemberCandidates(c.db, ID)
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0]?.sql).toContain('not exists')
  })

  it('file lists are one statement; the member list uses FILE_PUBLIC_SQL and never returns link counts', async () => {
    const a = recorder()
    await listActiveFilesForAdmin(a.db, ID, 'updated_desc', now)
    expect(a.calls).toHaveLength(1)
    expect(a.calls[0]?.sql).toContain('"status" = $')
    const b = recorder()
    await listPublicFilesForMember(b.db, ID, 'name_asc', now)
    expect(b.calls).toHaveLength(1)
    expect(b.calls[0]?.sql).toContain('not "app"."files"."suspended"')
    expect(b.calls[0]?.sql).not.toContain('share_links')
  })

  it.each([
    ['updated_desc', 'order by "app"."files"."updated_at" desc, "app"."files"."id" asc'],
    ['name_asc', 'order by "app"."files"."display_name" asc, "app"."files"."id" asc'],
    ['size_desc', 'order by "app"."files"."size_bytes" desc, "app"."files"."id" asc'],
  ] as const)('sort %s ends with id ascending', async (sort, expected) => {
    const { calls, db } = recorder()
    await listPublicFilesForMember(db, ID, sort, now)
    expect(calls[0]?.sql).toContain(expected)
  })
})
