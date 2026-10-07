// 06 10.2 / 04 3.10. Each step is independent: a failure is counted in `failed` and the next step still runs.
import 'server-only'
import { pingDb } from '@/server/db/client'

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

export async function runDaily(keepalive: () => Promise<void> = pingDb): Promise<CronStepResult[]> {
  const results: CronStepResult[] = []
  const run = async (step: CronStep, fn: () => Promise<number>) => {
    const t = Date.now()
    try {
      results.push({ step, processed: await fn(), failed: 0, ms: Date.now() - t })
    } catch (e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'cron.step_failed', step, error: e instanceof Error ? e.name : 'unknown' }))
      results.push({ step, processed: 0, failed: 1, ms: Date.now() - t })
    }
  }
  await run('keepalive', async () => {
    await keepalive()
    return 1
  })
  // Steps 2-6 (pending_cleanup, expired_files, purge_retry, ticket_hash_null, retention): WP-4.3.
  // Steps 7-8 (storage_reconcile, usage_warning) and the final 'system.cron_daily' audit log: WP-7.5 (needs app.audit_logs).
  return results
}
