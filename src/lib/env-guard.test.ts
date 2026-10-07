import { describe, expect, it } from 'vitest'
import { guardErrors, refFromDbUrl, refFromSupabaseUrl, roleFromDbUrl } from '@/lib/env-guard'

const OK = {
  APP_ENV: 'local',
  SUPABASE_URL: 'https://devref.supabase.co',
  DATABASE_URL: 'postgres://postgres.devref:SENTINEL-pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres',
  DATABASE_URL_MIGRATION: 'postgres://postgres.devref:SENTINEL-pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
}

describe('ref helpers', () => {
  it('extracts refs and role', () => {
    expect(refFromSupabaseUrl(OK.SUPABASE_URL)).toBe('devref')
    expect(refFromDbUrl(OK.DATABASE_URL)).toBe('devref')
    expect(roleFromDbUrl(OK.DATABASE_URL)).toBe('postgres')
  })
  it('returns null for missing or invalid input', () => {
    expect(refFromSupabaseUrl(undefined)).toBeNull()
    expect(refFromSupabaseUrl('not a url')).toBeNull()
    expect(refFromDbUrl('postgres://user:pw@localhost:6543/postgres')).toBeNull()
    expect(roleFromDbUrl('::')).toBeNull()
  })
})

describe('guardErrors', () => {
  it('passes for local / test with matching refs', () => {
    expect(guardErrors(OK)).toEqual([])
    expect(guardErrors({ ...OK, APP_ENV: 'test' })).toEqual([])
  })
  it('refuses APP_ENV=production and unset APP_ENV', () => {
    expect(guardErrors({ ...OK, APP_ENV: 'production' })).toHaveLength(1)
    expect(guardErrors({ ...OK, APP_ENV: undefined })).toHaveLength(1)
  })
  it('refuses a DB connection for another project, without printing secrets', () => {
    const errors = guardErrors({ ...OK, DATABASE_URL: OK.DATABASE_URL.replace('postgres.devref', 'postgres.prodref') })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('DATABASE_URL')
    expect(errors.join('\n')).not.toContain('SENTINEL')
  })
  it('refuses a DB connection whose project cannot be verified', () => {
    expect(guardErrors({ ...OK, DATABASE_URL: 'postgres://u:pw@localhost:6543/postgres' })).toHaveLength(1)
  })
  it('refuses when SUPABASE_URL is missing', () => {
    expect(guardErrors({ ...OK, SUPABASE_URL: undefined })).toContain('SUPABASE_URL is not set')
  })
})
