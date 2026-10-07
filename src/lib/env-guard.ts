// Pure helpers shared by config.ts, scripts/guard-env.ts, scripts/show-env.ts and the integration test setup (04 7.2).
// No server-only import: scripts run under tsx, outside Next.js. Nothing here returns keys or passwords.

/** Supabase project ref from SUPABASE_URL ("<ref>.supabase.co"). null if the URL is missing or invalid. */
export function refFromSupabaseUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.split('.')[0] ?? null
  } catch {
    return null
  }
}

/** Project ref from the DB connection user ("<role>.<project-ref>" on Supavisor). null if the user has no ref part. */
export function refFromDbUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const user = decodeURIComponent(new URL(url).username)
    const i = user.indexOf('.')
    return i >= 0 ? user.slice(i + 1) : null
  } catch {
    return null
  }
}

/** Role part of the DB connection user (no password). null if the URL is missing or invalid. */
export function roleFromDbUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return decodeURIComponent(new URL(url).username).split('.')[0] ?? null
  } catch {
    return null
  }
}

/**
 * Checks used before destructive operations (db:migrate, seed, integration tests). Returns error messages (empty = ok).
 * Messages contain only variable names, APP_ENV and project refs (not secrets).
 */
export function guardErrors(env: Record<string, string | undefined>): string[] {
  const errors: string[] = []
  if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
    errors.push(`APP_ENV must be "local" or "test" (got "${env.APP_ENV ?? ''}"). Production operations are performed by a human only.`)
  }
  if (!env.SUPABASE_URL) {
    errors.push('SUPABASE_URL is not set')
    return errors
  }
  const urlRef = refFromSupabaseUrl(env.SUPABASE_URL)
  if (!urlRef) {
    errors.push('SUPABASE_URL is not a valid URL')
    return errors
  }
  for (const name of ['DATABASE_URL', 'DATABASE_URL_MIGRATION'] as const) {
    const value = env[name]
    if (!value) continue
    // A missing ref part (not a Supavisor user) is also refused: the target project cannot be verified.
    const ref = refFromDbUrl(value)
    if (ref !== urlRef) errors.push(`${name} points to project "${ref ?? '(unknown)'}" but SUPABASE_URL is "${urlRef}"`)
  }
  return errors
}
