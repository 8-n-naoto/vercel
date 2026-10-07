import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '@/server/db/schema'

/** Anything that can run a read query: the pooled database, a transaction, or a test double (drizzle's pg-proxy). */
export type Reader = PgDatabase<PgQueryResultHKT, typeof schema>
