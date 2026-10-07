// scripts/guard-env.ts  -- run before destructive scripts (db:migrate, seed). Exits non-zero on any doubt.
import { config } from 'dotenv'
import { guardErrors, refFromSupabaseUrl } from '../src/lib/env-guard'

config({ path: '.env.local', quiet: true })

const errors = guardErrors(process.env)
if (errors.length > 0) {
  for (const e of errors) console.error(`guard-env: ${e}`)
  process.exit(1)
}

console.error(`guard-env: ok (APP_ENV=${process.env.APP_ENV}, project=${refFromSupabaseUrl(process.env.SUPABASE_URL)})`)
