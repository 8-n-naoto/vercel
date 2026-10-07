import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeTarget, getConfig, resetConfigCache } from '@/server/config'

// Sentinel strings that must never appear in error messages or describeTarget().
const SECRET_KEY = 'sb_secret_SENTINEL_0123456789abcdef'
const DB_PASSWORD = 'SENTINEL-db-password'

const BASE: Record<string, string> = {
  APP_ENV: 'local',
  SUPABASE_URL: 'https://devref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_SENTINEL_0123456789',
  SUPABASE_SECRET_KEY: SECRET_KEY,
  DATABASE_URL: `postgres://app_runtime.devref:${DB_PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
  APP_ORIGIN: 'http://localhost:3000',
  CONTENT_ORIGIN: 'http://127.0.0.1:3000',
  CRON_SECRET: 'cron-secret-SENTINEL-0000000000000000',
}

let saved: NodeJS.ProcessEnv

function setEnv(env: Record<string, string | undefined>) {
  for (const k of Object.keys(process.env)) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
  resetConfigCache()
}

function messageOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  throw new Error('expected getConfig() to throw')
}

beforeEach(() => {
  saved = { ...process.env }
})
afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k]
  Object.assign(process.env, saved)
  resetConfigCache()
})

describe('getConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    setEnv(BASE)
    const cfg = getConfig()
    expect(cfg.APP_ENV).toBe('local')
    expect(cfg.STORAGE_BUCKET).toBe('files')
    expect(cfg.MAX_FILE_SIZE_MB).toBe(50)
    expect(cfg.USER_QUOTA_MB).toBe(900)
    expect(cfg.SHARE_LINK_MAX_DAYS).toBe(90)
  })

  it('treats blank optional values as unset (.env.example leaves them empty)', () => {
    setEnv({ ...BASE, STORAGE_BUCKET: '', MAX_FILE_SIZE_MB: '  ', LOG_LEVEL: '' })
    const cfg = getConfig()
    expect(cfg.STORAGE_BUCKET).toBe('files')
    expect(cfg.MAX_FILE_SIZE_MB).toBe(50)
    expect(cfg.LOG_LEVEL).toBe('info')
  })

  it('memoizes the parsed value', () => {
    setEnv(BASE)
    expect(getConfig()).toBe(getConfig())
  })

  it('fails on missing required variables, naming them without leaking values', () => {
    setEnv({ ...BASE, SUPABASE_SECRET_KEY: undefined, CRON_SECRET: undefined })
    const msg = messageOf(getConfig)
    expect(msg).toContain('SUPABASE_SECRET_KEY')
    expect(msg).toContain('CRON_SECRET')
    for (const secret of [DB_PASSWORD, BASE.SUPABASE_PUBLISHABLE_KEY!]) expect(msg).not.toContain(secret)
  })

  it('does not leak received values when a value is invalid', () => {
    setEnv({ ...BASE, SUPABASE_SECRET_KEY: 'short-SENTINEL', DATABASE_URL: `mysql://u:${DB_PASSWORD}@h/db`, APP_ENV: 'SENTINEL-env' })
    const msg = messageOf(getConfig)
    expect(msg).toContain('SUPABASE_SECRET_KEY')
    expect(msg).toContain('DATABASE_URL')
    expect(msg).not.toContain('SENTINEL')
  })

  it('rejects identical hosts for the two origins', () => {
    setEnv({ ...BASE, CONTENT_ORIGIN: 'http://localhost:3001' })
    expect(messageOf(getConfig)).toContain('CONTENT_ORIGIN')
  })

  it('rejects origins with a trailing slash or path', () => {
    setEnv({ ...BASE, APP_ORIGIN: 'http://localhost:3000/' })
    expect(messageOf(getConfig)).toContain('APP_ORIGIN')
    setEnv({ ...BASE, APP_ORIGIN: 'http://localhost:3000/app' })
    expect(messageOf(getConfig)).toContain('APP_ORIGIN')
  })
})

describe('APP_ENV / VERCEL_ENV guard (04 7.2 item 1)', () => {
  const https = { APP_ORIGIN: 'https://app.example.test', CONTENT_ORIGIN: 'https://content.example.test' }

  it('Vercel production requires APP_ENV=production', () => {
    setEnv({ ...BASE, ...https, VERCEL_ENV: 'production', APP_ENV: 'test' })
    expect(messageOf(getConfig)).toContain('APP_ENV')
  })

  it('Vercel preview requires APP_ENV=test', () => {
    setEnv({ ...BASE, ...https, VERCEL_ENV: 'preview', APP_ENV: 'production' })
    expect(messageOf(getConfig)).toContain('APP_ENV')
    setEnv({ ...BASE, ...https, VERCEL_ENV: 'preview', APP_ENV: 'local' })
    expect(messageOf(getConfig)).toContain('APP_ENV')
  })

  it('APP_ENV=production outside Vercel is refused', () => {
    setEnv({ ...BASE, ...https, APP_ENV: 'production' })
    expect(messageOf(getConfig)).toContain('only allowed on Vercel production')
  })

  it('accepts the consistent combinations', () => {
    setEnv({ ...BASE, ...https, VERCEL_ENV: 'production', APP_ENV: 'production' })
    expect(getConfig().APP_ENV).toBe('production')
    setEnv({ ...BASE, ...https, VERCEL_ENV: 'preview', APP_ENV: 'test' })
    expect(getConfig().APP_ENV).toBe('test')
  })

  it('requires https outside local', () => {
    setEnv({ ...BASE, VERCEL_ENV: 'preview', APP_ENV: 'test' })
    expect(messageOf(getConfig)).toContain('APP_ORIGIN must be https')
  })
})

describe('project ref mixing (04 7.2 item 3)', () => {
  it('refuses a DATABASE_URL that points at another project (e.g. production)', () => {
    setEnv({ ...BASE, DATABASE_URL: `postgres://app_runtime.otherref:${DB_PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` })
    const msg = messageOf(getConfig)
    expect(msg).toContain('DATABASE_URL')
    expect(msg).not.toContain(DB_PASSWORD)
  })

  it('refuses a DATABASE_URL_MIGRATION that points at another project', () => {
    setEnv({ ...BASE, DATABASE_URL_MIGRATION: `postgres://postgres.otherref:${DB_PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` })
    expect(messageOf(getConfig)).toContain('DATABASE_URL_MIGRATION')
  })

  it('accepts matching refs', () => {
    setEnv({ ...BASE, DATABASE_URL_MIGRATION: `postgres://postgres.devref:${DB_PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` })
    expect(getConfig().DATABASE_URL_MIGRATION).toBeDefined()
  })
})

describe('describeTarget', () => {
  it('describes targets without keys or passwords', () => {
    setEnv(BASE)
    const target = describeTarget()
    expect(target).toEqual({
      env: 'local',
      supabaseProjectRef: 'devref',
      dbHost: 'aws-0-ap-northeast-1.pooler.supabase.com',
      dbPort: '6543',
      bucket: 'files',
      appOrigin: 'http://localhost:3000',
      contentOrigin: 'http://127.0.0.1:3000',
    })
    const json = JSON.stringify(target)
    for (const secret of [SECRET_KEY, DB_PASSWORD, BASE.SUPABASE_PUBLISHABLE_KEY!, BASE.CRON_SECRET!]) expect(json).not.toContain(secret)
  })
})
