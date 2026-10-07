import { describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@/server/db/schema'
import type { Db } from './audit-logs'
import { findFileWithFolderAndMembership } from './files'
import { findFolderWithMembership } from './folders'
import { findShareLinkWithFileAndFolder } from './share-links'

// The statements are captured by the drizzle logger before they are sent; the send itself fails (nothing listens) and is ignored. No database is touched.
async function capture(run: (tx: Db) => Promise<unknown>): Promise<string> {
  const seen: string[] = []
  const client = postgres('postgres://u:p@127.0.0.1:1/none', { max: 1, connect_timeout: 1 }) // lazy: nothing connects until a query runs
  const db = drizzle(client, { schema, logger: { logQuery: (q) => void seen.push(q) } })
  await run(db).catch(() => undefined)
  await client.end({ timeout: 0 })
  expect(seen).toHaveLength(1) // one statement per assert (06 3.4)
  return seen[0]!
}

describe('06 3.4 single-statement queries', () => {
  it.each([
    ['none', false],
    ['share', true],
    ['update', true],
  ] as const)('folder lock %s', async (lock, locked) => {
    const q = await capture((tx) => findFolderWithMembership(tx, 'f', 'u', lock))
    expect(q).toMatch(/left join "app"."folder_members" "fm"/)
    if (locked) expect(q).toMatch(new RegExp(`for ${lock} of "f"$`))
    else expect(q).not.toMatch(/ for /)
  })
  it.each([
    ['none', false, undefined],
    ['share', false, 'for share of "f"'],
    ['update', false, 'for update of "f"'],
    ['none', true, 'for update of "fi"'],
    ['update', true, 'for update of "f", "fi"'],
    ['share', true, 'for update of "f", "fi"'],
  ] as const)('file lock %s lockFile %s', async (lock, lockFile, clause) => {
    const q = await capture((tx) => findFileWithFolderAndMembership(tx, 'fi', 'u', lock, lockFile))
    expect(q).toMatch(/"fi"."status" <> \$/)
    if (clause) expect(q.endsWith(clause)).toBe(true)
    else expect(q).not.toMatch(/ for /)
  })
  it.each([
    [false, undefined],
    [true, 'for update of "sl"'],
  ] as const)('share link lockLink %s', async (lockLink, clause) => {
    const q = await capture((tx) => findShareLinkWithFileAndFolder(tx, 'l', lockLink))
    expect(q).toMatch(/"fi"."status" <> \$/)
    expect(q).toMatch(/"f"."deleted_at" is null/)
    if (clause) expect(q.endsWith(clause)).toBe(true)
    else expect(q).not.toMatch(/ for /)
  })
})
