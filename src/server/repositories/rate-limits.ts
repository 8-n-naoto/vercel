import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import type { rateLimits } from '@/server/db/schema'

export type RateLimitRow = typeof rateLimits.$inferSelect

export interface RateLimitHit {
  count: number
  retryAfter: number
}

interface HitRow extends Record<string, unknown> {
  count: number
  retry_after: number
}

function toHit(rows: readonly HitRow[]): RateLimitHit {
  const row = rows[0]
  if (!row) throw new Error('rate_limits upsert returned no row')
  return { count: Number(row.count), retryAfter: Number(row.retry_after) }
}

/** 07 5.1: one UPSERT, committed immediately (no surrounding transaction). The window is derived from the DB clock. */
export async function incrementRateLimit(key: string, windowSec: number): Promise<RateLimitHit> {
  const rows = await getDb().execute<HitRow>(sql`
    INSERT INTO app.rate_limits AS r (key, window_start, count)
    VALUES (${key}, date_bin(make_interval(secs => ${windowSec}::double precision), now(), timestamptz '2000-01-01 00:00:00+00'), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
    RETURNING r.count,
              GREATEST(1, ceil(extract(epoch FROM (r.window_start + make_interval(secs => ${windowSec}::double precision) - now()))))::int AS retry_after`)
  return toHit(rows)
}

/** Variant of the same SQL with an explicit window_start (07 5.2 RL-09: now() cannot be changed in a test). */
export async function incrementRateLimitAt(key: string, windowStart: Date, windowSec: number): Promise<RateLimitHit> {
  const rows = await getDb().execute<HitRow>(sql`
    INSERT INTO app.rate_limits AS r (key, window_start, count)
    VALUES (${key}, ${windowStart.toISOString()}::timestamptz, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
    RETURNING r.count,
              GREATEST(1, ceil(extract(epoch FROM (r.window_start + make_interval(secs => ${windowSec}::double precision) - now()))))::int AS retry_after`)
  return toHit(rows)
}

/** Test helper: removes the counters of one key (integration tests only). */
export async function deleteRateLimitsByKeyPrefix(prefix: string): Promise<void> {
  await getDb().execute(sql`DELETE FROM app.rate_limits WHERE starts_with(key, ${prefix})`)
}

/** Test helper (RL-09): the window start for a given instant, computed by the same date_bin expression as the UPSERT. */
export async function binWindowStart(at: string, windowSec: number): Promise<Date> {
  const rows = await getDb().execute<{ w: Date }>(
    sql`SELECT date_bin(make_interval(secs => ${windowSec}::double precision), ${at}::timestamptz, timestamptz '2000-01-01 00:00:00+00') AS w`,
  )
  const w = rows[0]?.w
  if (!w) throw new Error('date_bin returned no row')
  return new Date(w)
}

/** Test helper (RL-09): number of counter rows of one key. */
export async function countRateLimitRows(key: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM app.rate_limits WHERE key = ${key}`)
  return Number(rows[0]?.n ?? 0)
}
