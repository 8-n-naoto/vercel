import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = { getAll: vi.fn(), set: vi.fn() }
vi.mock('next/headers', () => ({ cookies: async () => store }))
const createServerClient = vi.fn()
vi.mock('@supabase/ssr', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }))

import { resetConfigCache } from '@/server/config'
import { authCookieBaseName, createSupabaseProxyClient, createSupabaseServerClient, enforceCookieOptions, isAuthCookieName, type PendingCookie } from './supabase-server'

const env = { secure: true, maxAgeCapSec: 7 * 86_400 }

describe('enforceCookieOptions (02 5.1.2, D9)', () => {
  it('forces HttpOnly, SameSite=Lax, Path=/, Secure and drops Domain', () => {
    const o = enforceCookieOptions({ domain: '.example.com', httpOnly: false, secure: false, sameSite: 'none', path: '/x', maxAge: 60 }, env)
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: true, maxAge: 60 })
    expect('domain' in o).toBe(false)
  })
  it('caps Max-Age at SESSION_MAX_AGE_DAYS (the library default is 400 days) and applies it when absent', () => {
    expect(enforceCookieOptions({ maxAge: 400 * 86_400 }, env).maxAge).toBe(7 * 86_400)
    expect(enforceCookieOptions({}, env).maxAge).toBe(7 * 86_400)
  })
  it('keeps a removal (maxAge 0 or negative) as 0', () => {
    expect(enforceCookieOptions({ maxAge: 0 }, env).maxAge).toBe(0)
    expect(enforceCookieOptions({ maxAge: -1 }, env).maxAge).toBe(0)
  })
  it('Secure follows the environment (false only for http://localhost)', () => {
    expect(enforceCookieOptions({}, { ...env, secure: false }).secure).toBe(false)
  })
})

describe('auth cookie names', () => {
  it('base name is derived from SUPABASE_URL (sb-<ref>-auth-token)', () => {
    expect(authCookieBaseName('https://abcref.supabase.co')).toBe('sb-abcref-auth-token')
    expect(authCookieBaseName()).toBe('sb-testref-auth-token') // src/tests/setup.ts
    expect(() => authCookieBaseName('not a url')).toThrow()
  })
  it('matches the base, its chunks and the PKCE verifier; not other cookies', () => {
    const base = 'sb-testref-auth-token'
    for (const n of [base, `${base}.0`, `${base}.12`, `${base}-code-verifier`]) expect(isAuthCookieName(n, base), n).toBe(true)
    for (const n of ['sb-other-auth-token', 'theme', `x${base}`, 'sb-testref-auth-tokens']) expect(isAuthCookieName(n, base), n).toBe(false)
  })
})

describe('createSupabaseServerClient setAll', () => {
  beforeEach(() => {
    store.getAll.mockReset()
    store.set.mockReset()
    createServerClient.mockReset()
    resetConfigCache()
  })
  const capture = async () => {
    await createSupabaseServerClient()
    const opts = createServerClient.mock.calls[0]?.[2] as { cookieOptions: { name: string }; cookies: { setAll: (c: PendingCookie[], h: Record<string, string>) => void } }
    return opts
  }
  it('passes the explicit storage key and writes cookies with the forced attributes', async () => {
    const opts = await capture()
    expect(opts.cookieOptions.name).toBe('sb-testref-auth-token')
    opts.cookies.setAll([{ name: 'sb-testref-auth-token', value: 'v', options: { httpOnly: false, domain: 'evil.example', maxAge: 400 * 86_400 } }], {})
    expect(store.set).toHaveBeenCalledTimes(1)
    const [name, , options] = store.set.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(name).toBe('sb-testref-auth-token')
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 86_400 })
    expect('domain' in options).toBe(false)
    expect(options.secure).toBe(false) // APP_ORIGIN is http://localhost:3000 in unit tests
  })
  it('swallows the error of a read-only cookie store (Server Components)', async () => {
    store.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler')
    })
    const opts = await capture()
    expect(() => opts.cookies.setAll([{ name: 'a', value: 'b', options: {} }], {})).not.toThrow()
  })
})

describe('createSupabaseProxyClient', () => {
  it('collects cookies (forced attributes) and the no-store headers instead of writing them', () => {
    createServerClient.mockReset()
    const sink: { cookies: PendingCookie[]; headers: Record<string, string> } = { cookies: [], headers: {} }
    createSupabaseProxyClient([{ name: 'a', value: 'b' }], sink)
    const opts = createServerClient.mock.calls[0]?.[2] as { cookies: { getAll: () => unknown; setAll: (c: PendingCookie[], h: Record<string, string>) => void } }
    expect(opts.cookies.getAll()).toEqual([{ name: 'a', value: 'b' }])
    opts.cookies.setAll([{ name: 'sb-testref-auth-token', value: 'v', options: { httpOnly: false } }], { 'Cache-Control': 'private, no-store' })
    expect(sink.cookies[0]?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
    expect(sink.headers).toEqual({ 'Cache-Control': 'private, no-store' })
  })
})
