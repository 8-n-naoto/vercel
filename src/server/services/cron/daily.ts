// 06 10.2 / 07 10 / 04 3.10. Each step is independent: a failure is counted in `failed` and the next step still runs.
// 07 10 names this module services/maintenance.ts `runDaily(ctx, deps)`; it stays here as `runDaily(deps?)` (WP-0.5 layout).
// Steps 2-4 (WP-4.3) select with FOR UPDATE SKIP LOCKED / LIMIT, change the rows in one transaction, and remove the objects
// after the commit (100 paths at a time). A failed removal leaves purged_at NULL; step 4 retries it.
import 'server-only'
import { getConfig } from '@/server/config'
import { getDb, pingDb } from '@/server/db/client'
import {
  listUnpurgedDeletedFiles,
  lockAbandonedPendingFiles,
  lockExpiredActiveFiles,
  markFilesDeletedBySystem,
  markFilesPurged,
} from '@/server/repositories/files'
import { revokeLinksForExpiredFiles } from '@/server/repositories/share-links'
import { getObjects, type ObjectsAdapter } from '@/server/storage/objects'

export type CronStep =
  | 'keepalive'
  | 'pending_cleanup'
  | 'expired_files'
  | 'purge_retry'
  | 'ticket_hash_null'
  | 'retention'
  | 'storage_reconcile'
  | 'usage_warning'

export interface CronStepResult {
  step: CronStep
  processed: number
  failed: number
  ms: number
  skipped?: true
}

/** 07 10.2: at most this many files per step and run; the rest is handled the next day. */
export const FILE_STEP_LIMIT = 500
const PURGE_CHUNK = 100

export interface FileTarget {
  id: string
  storagePath: string
}

/** The data access of steps 2-4. The default talks to the database; unit tests pass a double. */
export interface DailyStore {
  /** Step 2: one transaction (select SKIP LOCKED, mark deleted/upload_abandoned). Returns the rows changed. */
  abandonPending: (now: Date, limit: number) => Promise<FileTarget[]>
  /** Step 3: one transaction (select SKIP LOCKED, mark deleted/expired, revoke open links). Returns the rows changed. */
  expireFiles: (now: Date, retentionDays: number, limit: number) => Promise<FileTarget[]>
  /** Step 4: deleted files with purged_at NULL, oldest deletion first. */
  listUnpurged: (limit: number) => Promise<FileTarget[]>
  /** One statement (id = ANY). */
  markPurged: (ids: string[], at: Date) => Promise<void>
}

export const defaultDailyStore: DailyStore = {
  abandonPending: (now, limit) =>
    getDb().transaction(async (tx) => {
      const rows = await lockAbandonedPendingFiles(tx, now, limit)
      await markFilesDeletedBySystem(tx, rows.map((r) => r.id), 'upload_abandoned', now)
      return rows
    }),
  expireFiles: (now, retentionDays, limit) =>
    getDb().transaction(async (tx) => {
      const rows = await lockExpiredActiveFiles(tx, now, retentionDays, limit)
      const ids = rows.map((r) => r.id)
      await markFilesDeletedBySystem(tx, ids, 'expired', now)
      await revokeLinksForExpiredFiles(tx, ids, now)
      return rows
    }),
  listUnpurged: (limit) => listUnpurgedDeletedFiles(getDb(), limit),
  markPurged: (ids, at) => markFilesPurged(getDb(), ids, at),
}

export interface DailyDeps {
  keepalive: () => Promise<void>
  /** `$now` of every SQL statement; tests fix it. */
  now: () => Date
  objects: () => ObjectsAdapter
  retentionDays: () => number
  store: DailyStore
}

export const defaultDailyDeps: DailyDeps = {
  keepalive: pingDb,
  now: () => new Date(),
  objects: getObjects,
  retentionDays: () => getConfig().EXPIRED_FILE_RETENTION_DAYS,
  store: defaultDailyStore,
}

/** processed: rows whose state this step changed (step 4: rows that got purged_at). failed: per-file exceptions + objects that could not be removed. */
type StepOutcome = number | { processed: number; failed: number }

function log(event: string, extra: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }))
}

/** Removes the objects (100 paths per call) and sets purged_at for the removed ones. A missing object counts as removed. */
async function purge(targets: FileTarget[], deps: DailyDeps, now: Date): Promise<{ purged: number; failed: number }> {
  const objects = deps.objects()
  let purged = 0
  let failed = 0
  for (let i = 0; i < targets.length; i += PURGE_CHUNK) {
    const chunk = targets.slice(i, i + PURGE_CHUNK)
    try {
      const r = await objects.removeMany(chunk.map((t) => t.storagePath))
      const removed = new Set(r.removed)
      const okIds = chunk.filter((t) => removed.has(t.storagePath)).map((t) => t.id)
      if (okIds.length > 0) await deps.store.markPurged(okIds, now)
      purged += okIds.length
      failed += chunk.length - okIds.length
    } catch (e) {
      failed += chunk.length
      log('cron.purge_failed', { error: e instanceof Error ? e.name : 'unknown' }) // never the paths
    }
  }
  return { purged, failed }
}

function truncated(step: CronStep, count: number): void {
  if (count >= FILE_STEP_LIMIT) log('cron.step_truncated', { step, limit: FILE_STEP_LIMIT })
}

export async function runDaily(overrides: Partial<DailyDeps> = {}): Promise<CronStepResult[]> {
  const deps: DailyDeps = { ...defaultDailyDeps, ...overrides }
  const now = deps.now()
  const results: CronStepResult[] = []
  const run = async (step: CronStep, fn: () => Promise<StepOutcome>) => {
    const t = Date.now()
    try {
      const out = await fn()
      const r = typeof out === 'number' ? { processed: out, failed: 0 } : out
      results.push({ step, ...r, ms: Date.now() - t })
    } catch (e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'cron.step_failed', step, error: e instanceof Error ? e.name : 'unknown' }))
      results.push({ step, processed: 0, failed: 1, ms: Date.now() - t })
    }
  }
  await run('keepalive', async () => {
    await deps.keepalive()
    return 1
  })
  await run('pending_cleanup', async () => {
    const rows = await deps.store.abandonPending(now, FILE_STEP_LIMIT)
    truncated('pending_cleanup', rows.length)
    return { processed: rows.length, failed: (await purge(rows, deps, now)).failed }
  })
  await run('expired_files', async () => {
    const rows = await deps.store.expireFiles(now, deps.retentionDays(), FILE_STEP_LIMIT)
    truncated('expired_files', rows.length)
    return { processed: rows.length, failed: (await purge(rows, deps, now)).failed }
  })
  await run('purge_retry', async () => {
    const rows = await deps.store.listUnpurged(FILE_STEP_LIMIT)
    truncated('purge_retry', rows.length)
    const r = await purge(rows, deps, now)
    return { processed: r.purged, failed: r.failed }
  })
  // Steps 5-8 (ticket_hash_null, retention, storage_reconcile, usage_warning) and the final
  // 'system.cron_daily' audit log: WP-7.5 (needs app.audit_logs).
  return results
}
