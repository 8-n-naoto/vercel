// Storage bucket client with the secret key. Server only; used by src/server/storage/objects.ts (06 7.7).
// (supabase-admin.ts is restricted to services by eslint, so the storage adapter builds its own client.)
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getConfig } from '@/server/config'

/** A new client per call; no session is persisted. The returned object is the bucket-scoped file API. */
export function createBucketClient() {
  const cfg = getConfig()
  const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client.storage.from(cfg.STORAGE_BUCKET)
}
