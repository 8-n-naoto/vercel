// Supabase client with the secret key (SUPABASE_SECRET_KEY). Server only; used by services in Phase 2 (invite, disable user).
// Only the factory exists in WP-1.3. Importing this module is restricted to src/server/services (eslint.config.mjs).
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getConfig } from '@/server/config'

/** A new client per call: no session is persisted and nothing is refreshed, so it holds no per-user state. */
export function createSupabaseAdminClient(): SupabaseClient {
  const cfg = getConfig()
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
