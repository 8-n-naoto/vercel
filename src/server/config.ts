import 'server-only'
import { z } from 'zod'
import { refFromDbUrl, refFromSupabaseUrl } from '@/lib/env-guard'

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback)
const origin = z
  .url()
  .refine((v) => !v.endsWith('/'), 'must not end with a slash')
  .refine((v) => new URL(v).pathname === '/', 'must be an origin only')

const schema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'production']), // D-016 (approved)
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    SUPABASE_SECRET_KEY: z.string().min(20),
    DATABASE_URL: z.string().startsWith('postgres'), // Transaction pooler (6543)
    DATABASE_URL_MIGRATION: z.string().startsWith('postgres').optional(), // Session pooler (5432)
    APP_ORIGIN: origin,
    CONTENT_ORIGIN: origin,
    STORAGE_BUCKET: z.string().min(1).default('files'),
    CRON_SECRET: z.string().min(32),
    MAX_FILE_SIZE_MB: positiveInt(50),
    USER_QUOTA_MB: positiveInt(900),
    TOTAL_QUOTA_MB: positiveInt(900),
    EGRESS_MONTHLY_LIMIT_GB: positiveInt(5),
    INVITE_TTL_HOURS: positiveInt(72),
    RESET_TTL_HOURS: positiveInt(24),
    SHARE_LINK_DEFAULT_DAYS: positiveInt(7),
    SHARE_LINK_MAX_DAYS: positiveInt(90),
    VIEW_TICKET_TTL_SEC: positiveInt(60),
    DOWNLOAD_TICKET_TTL_SEC: positiveInt(600),
    SESSION_MAX_AGE_DAYS: positiveInt(7),
    EXPIRED_FILE_RETENTION_DAYS: positiveInt(30),
    ACCESS_LOG_RETENTION_DAYS: positiveInt(180),
    AUDIT_LOG_RETENTION_DAYS: positiveInt(365),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    APP_COOKIE_SECRET: z.string().min(32).optional(), // only if 02 5.1.4 alternative is adopted
    VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(), // set by Vercel
  })
  .superRefine((v, ctx) => {
    const fail = (message: string, path: string) => ctx.addIssue({ code: 'custom', message, path: [path] })
    // Compare hostnames, not host:port: cookies are not isolated by port, so the same hostname on two ports is not a separate origin for 02 5.7.
    if (new URL(v.APP_ORIGIN).hostname === new URL(v.CONTENT_ORIGIN).hostname) {
      fail('APP_ORIGIN and CONTENT_ORIGIN must have different hosts', 'CONTENT_ORIGIN')
    }
    // Guard against mixing environments (section 7): the Vercel environment and APP_ENV must agree.
    if (v.VERCEL_ENV === 'production' && v.APP_ENV !== 'production') fail('Vercel production requires APP_ENV=production', 'APP_ENV')
    if (v.VERCEL_ENV === 'preview' && v.APP_ENV !== 'test') fail('Vercel preview requires APP_ENV=test', 'APP_ENV')
    if (v.VERCEL_ENV === undefined && v.APP_ENV === 'production') fail('APP_ENV=production is only allowed on Vercel production', 'APP_ENV')
    if (v.APP_ENV !== 'local' && !v.APP_ORIGIN.startsWith('https://')) fail('APP_ORIGIN must be https outside local', 'APP_ORIGIN')
    // Project refs must agree (04 7.2): a DB connection that points at another project than SUPABASE_URL (e.g. production) is refused.
    // The ref part exists on Supavisor users ("<role>.<ref>"); connections without it (direct / local) are not checked here.
    const urlRef = refFromSupabaseUrl(v.SUPABASE_URL)
    const dbRef = refFromDbUrl(v.DATABASE_URL)
    if (dbRef !== null && dbRef !== urlRef) fail('DATABASE_URL points to a different Supabase project than SUPABASE_URL', 'DATABASE_URL')
    const migRef = v.DATABASE_URL_MIGRATION ? refFromDbUrl(v.DATABASE_URL_MIGRATION) : null
    if (migRef !== null && migRef !== urlRef) {
      fail('DATABASE_URL_MIGRATION points to a different Supabase project than SUPABASE_URL', 'DATABASE_URL_MIGRATION')
    }
  })

export type Config = z.infer<typeof schema>

let cached: Config | undefined

/** Blank values (.env.example leaves optional values empty) are treated as unset so that the defaults apply. */
function readEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) out[k] = v === undefined || v.trim() === '' ? undefined : v
  return out
}

export function getConfig(): Config {
  if (cached) return cached
  const parsed = schema.safeParse(readEnv())
  if (!parsed.success) {
    // Print variable names and messages only. Never print received values.
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }
  cached = parsed.data
  return cached
}

/** Test helper: forget the memoized config so that the next getConfig() re-reads process.env. */
export function resetConfigCache(): void {
  cached = undefined
}

/** Safe description of the connection targets. Contains no keys or passwords. */
export function describeTarget(cfg: Config = getConfig()) {
  const supabaseHost = new URL(cfg.SUPABASE_URL).hostname // <project-ref>.supabase.co
  const dbUrl = new URL(cfg.DATABASE_URL)
  return {
    env: cfg.APP_ENV,
    supabaseProjectRef: supabaseHost.split('.')[0],
    dbHost: dbUrl.hostname, // pooler host (aws-0-<region>.pooler.supabase.com)
    dbPort: dbUrl.port,
    bucket: cfg.STORAGE_BUCKET,
    appOrigin: cfg.APP_ORIGIN,
    contentOrigin: cfg.CONTENT_ORIGIN,
  }
}
