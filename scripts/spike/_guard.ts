// Shared guard for spike scripts: refuse to run unless the target is the dev project. Never prints values.
import { config } from 'dotenv'
import { guardErrors, refFromSupabaseUrl } from '../../src/lib/env-guard'

config({ path: '.env.local', quiet: true })

export function requireDevEnv(): void {
  const errors = guardErrors(process.env)
  if (errors.length > 0) {
    for (const e of errors) console.error(`spike guard: ${e}`)
    process.exit(1)
  }
  console.error(`spike guard: ok (APP_ENV=${process.env.APP_ENV}, project=${refFromSupabaseUrl(process.env.SUPABASE_URL)})`)
}
