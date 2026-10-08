// e2e/global-setup.ts
import postgres from 'postgres'
import { createHash } from 'node:crypto'
import { SEED_EMAILS, SEED_EXTRA_EMAILS } from '../scripts/seed-lib'
import { DEFAULT_BASE_URL, DEFAULT_CONTENT_URL, envOrDefault } from './support/base-url'

// Key forms (rateLimitIpPart, D-021) of the addresses a local run is seen from: IPv4, IPv4-mapped, ::1 (rounded to /64) and unknown.
const LOCAL_IP_PARTS = ['127.0.0.1', '0:0:0:0::/64', 'unknown']
const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

export default async function globalSetup() {
  // D-016: E2E never runs against production. APP_ENV must be local or test (checked in addition to the host allow list).
  if (process.env.APP_ENV !== 'local' && process.env.APP_ENV !== 'test') {
    throw new Error(`E2E requires APP_ENV=local or APP_ENV=test (got "${process.env.APP_ENV ?? ''}"). Refusing to run.`)
  }
  const targets = [envOrDefault(process.env.E2E_BASE_URL, DEFAULT_BASE_URL), envOrDefault(process.env.E2E_CONTENT_URL, DEFAULT_CONTENT_URL)]
  // E2E_ALLOWED_HOSTS: comma separated hostnames of the TEST environment (set by a human). Never put production hostnames here.
  const allowed = new Set(['localhost', '127.0.0.1', ...(process.env.E2E_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)])
  for (const t of targets) {
    const host = new URL(t).hostname
    if (!allowed.has(host)) {
      throw new Error(`E2E target host "${host}" is not in the allowed list (localhost, 127.0.0.1, E2E_ALLOWED_HOSTS). Refusing to run.`)
    }
  }

  // Clear the login counters of the seed users so that a re-run within 15 minutes does not hit login:email (5 / 900 s) or login:ip (20 / 900 s).
  // Same idea as deleteLoginCounters in the integration tests. Only E2E_DB=1 and only these keys (06 3.5 key layout; the rule limits stay as designed).
  if (process.env.E2E_DB === '1') {
    const dbUrl = (process.env.DATABASE_URL ?? '').trim()
    if (dbUrl === '') throw new Error('E2E_DB=1 needs DATABASE_URL to clear the seed users\' login counters.')
    const prefixes = [
      ...[...SEED_EMAILS, ...SEED_EXTRA_EMAILS].map((e) => `login:email:${sha256hex(e.trim().toLowerCase())}`),
      ...['login:ip', 'token:ip', 'raw:ip'].flatMap((rule) => LOCAL_IP_PARTS.map((ip) => `${rule}:${ip}`)),
    ]
    const sql = postgres(dbUrl, { prepare: false, max: 1, connect_timeout: 10 })
    try {
      for (const p of prefixes) await sql`DELETE FROM app.rate_limits WHERE starts_with(key, ${p})`
    } finally {
      await sql.end()
    }
  }
}
