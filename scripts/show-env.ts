// scripts/show-env.ts  -- prints the connection targets. Never prints keys or passwords.
import { config } from 'dotenv'
import { refFromDbUrl, refFromSupabaseUrl, roleFromDbUrl } from '../src/lib/env-guard'

config({ path: '.env.local', quiet: true })

function hostPort(value: string | undefined): string {
  if (!value) return '(unset)'
  try {
    const u = new URL(value)
    return `${u.hostname}:${u.port}`
  } catch {
    return '(invalid URL)'
  }
}

function main() {
  const env = process.env
  const rows: [string, string][] = [
    ['APP_ENV', env.APP_ENV || '(unset)'],
    ['supabase project ref (SUPABASE_URL)', refFromSupabaseUrl(env.SUPABASE_URL) ?? '(unset)'],
    ['db project ref (DATABASE_URL user)', env.DATABASE_URL ? (refFromDbUrl(env.DATABASE_URL) ?? '(none)') : '(unset)'],
    ['db role (DATABASE_URL user)', roleFromDbUrl(env.DATABASE_URL) ?? '(unset)'],
    ['db host:port (DATABASE_URL)', hostPort(env.DATABASE_URL)],
    ['migration host:port', hostPort(env.DATABASE_URL_MIGRATION)],
    ['bucket', env.STORAGE_BUCKET || 'files (default)'],
    ['APP_ORIGIN', env.APP_ORIGIN || '(unset)'],
    ['CONTENT_ORIGIN', env.CONTENT_ORIGIN || '(unset)'],
  ]
  for (const [k, v] of rows) console.error(`${k.padEnd(40)} ${v}`)
}

main()
