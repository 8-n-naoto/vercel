// Supabase client with the publishable key and no Cookie / session storage. Used only to verify a password (06 4.6 step 1)
// without touching the caller's session. Server only.
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getConfig } from '@/server/config'

/** A new client per call: nothing is persisted or refreshed. */
export function createSupabaseEphemeralClient(): SupabaseClient {
  const cfg = getConfig()
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
