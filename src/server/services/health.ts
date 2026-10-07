// 06 10.3 / 04 3.9. Never put keys, connection strings or error messages into the result (error = error name only).
import 'server-only'
import { describeTarget, getConfig, type Config } from '@/server/config'
import { pingDb } from '@/server/db/client'

export interface HealthCheck {
  ok: boolean
  ms: number
  error?: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  env: 'local' | 'test' | 'production'
  supabaseProjectRef: string
  checks: Record<'db' | 'storage', HealthCheck>
  totalMs: number
  ts: string
}

export interface HealthProbes {
  db: () => Promise<void>
  storage: (cfg: Config) => Promise<void>
}

/** Lists at most 1 object of the private bucket with the server-only key (REST; 04 3.9, S2 decides fetch vs supabase-js). */
export async function pingStorage(cfg: Config): Promise<void> {
  const res = await fetch(`${cfg.SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(cfg.STORAGE_BUCKET)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.SUPABASE_SECRET_KEY}`, apikey: cfg.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 1 }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`status ${res.status}`) // only the name of the error leaves this module
}

const DEFAULT_PROBES: HealthProbes = { db: pingDb, storage: pingStorage }

async function time(fn: () => Promise<void>): Promise<HealthCheck> {
  const t = Date.now()
  try {
    await fn()
    return { ok: true, ms: Date.now() - t }
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.name : 'error' } // no message: it may contain connection details
  }
}

export async function checkHealth(probes: HealthProbes = DEFAULT_PROBES): Promise<HealthResponse> {
  const cfg = getConfig()
  const started = Date.now()
  const [db, storage] = await Promise.all([time(probes.db), time(() => probes.storage(cfg))])
  const target = describeTarget(cfg)
  return {
    status: db.ok && storage.ok ? 'ok' : 'degraded',
    env: target.env,
    supabaseProjectRef: target.supabaseProjectRef ?? '',
    checks: { db, storage },
    totalMs: Date.now() - started,
    ts: new Date().toISOString(),
  }
}
