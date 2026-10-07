import 'server-only'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { getConfig } from '@/server/config'
import * as schema from './schema'

type Db = ReturnType<typeof drizzle<typeof schema>>
let cached: { sql: postgres.Sql; db: Db } | undefined

function open(): { sql: postgres.Sql; db: Db } {
  if (!cached) {
    const sql = postgres(getConfig().DATABASE_URL, {
      prepare: false, // Transaction pooler (6543) does not support prepared statements (U2)
      max: 3, // per function instance; Supavisor pool size on Free is small. Tune in Phase 0 (S3)
      idle_timeout: 20, // seconds
      connect_timeout: 10, // seconds
      onnotice: () => {}, // keep logs clean
    })
    cached = { sql, db: drizzle(sql, { schema }) }
  }
  return cached
}

export function getDb(): Db {
  return open().db
}

/** For /api/health: raw connectivity check that does not depend on any table. */
export async function pingDb(): Promise<void> {
  await open().sql`select 1`
}

/** Raw identity check (current_user / current_database). Used by the Phase 0 connectivity script. */
export async function whoAmI(): Promise<{ currentUser: string; currentDatabase: string }> {
  const rows = await open().sql<{ current_user: string; current_database: string }[]>`select current_user, current_database()`
  const row = rows[0]
  if (!row) throw new Error('whoAmI returned no row')
  return { currentUser: row.current_user, currentDatabase: row.current_database }
}

/** Closes the pool (scripts and tests only). */
export async function closeDb(): Promise<void> {
  if (cached) {
    const { sql } = cached
    cached = undefined
    await sql.end({ timeout: 5 })
  }
}
