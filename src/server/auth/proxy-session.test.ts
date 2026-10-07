import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createServerClient = vi.fn()
vi.mock('@supabase/ssr', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }))

import { isPublicPath, loginRedirectPath, refreshSession, safeNextPath } from './proxy-session'

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'GET', headers: { host: 'localhost:3000', ...init.headers } })

describe('isPublicPath (PUBLIC_PAGES, 06 11)', () => {
  it('public pages and token pages are public', () => {
    for (const p of ['/login', '/login/', '/invite/abc', '/reset/abc', '/s/abc', '/api/health', '/api/cron/daily']) expect(isPublicPath(p), p).toBe(true)
  })
  it('app pages are not public; nested or empty token segments do not match', () => {
    for (const p of ['/', '/folders', '/admin/users', '/view/1', '/invite', '/invite/', '/invite/a/b', '/s', '/loginx', '/apiary']) expect(isPublicPath(p), p).toBe(false)
  })
})

describe('safeNextPath (open redirect)', () => {
  it('accepts relative paths and rejects absolute, protocol-relative and backslash forms', () => {
    expect(safeNextPath('/folders/1?x=1')).toBe('/folders/1?x=1')
    const backslash = String.fromCharCode(92)
    for (const p of ['//evil.example', 'https://evil.example', 'folders', `/${backslash}evil.example`, `/a${backslash}b`, `/${'a'.repeat(2048)}`]) {
      expect(safeNextPath(p), p).toBeNull()
    }
  })
})

describe('safeNextPath shares the zNextPath rules (F-005)', () => {
  it('rejects control characters (raw and percent-encoded) and encoded backslashes', () => {
    for (const p of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/%09/evil.example', '/%0a/evil.example', '/%5c%5cevil', '/\u0000']) {
      expect(safeNextPath(p), JSON.stringify(p)).toBeNull()
    }
  })
})

describe('loginRedirectPath (02 2.6 step 6)', () => {
  it('signed out on an app page -> /login?next=<path+query encoded>', () => {
    expect(loginRedirectPath(req('/folders/abc?tab=files'), false)).toBe('/login?next=%2Ffolders%2Fabc%3Ftab%3Dfiles')
    expect(loginRedirectPath(req('/'), false)).toBe('/login?next=%2F')
  })
  it('the next value is always inside the query of /login (never a redirect target of its own)', () => {
    const out = loginRedirectPath(req('/%2F%2Fevil.example/x'), false)
    expect(out === null || out.startsWith('/login')).toBe(true)
  })
  it('signed in, public pages, /api and non-navigation requests pass', () => {
    expect(loginRedirectPath(req('/folders'), true)).toBeNull()
    expect(loginRedirectPath(req('/login'), false)).toBeNull()
    expect(loginRedirectPath(req('/s/abc'), false)).toBeNull()
    expect(loginRedirectPath(req('/api/health'), false)).toBeNull()
    expect(loginRedirectPath(req('/folders', { method: 'POST' }), false)).toBeNull()
    expect(loginRedirectPath(req('/folders', { method: 'POST', headers: { 'next-action': 'abc' } }), false)).toBeNull()
    expect(loginRedirectPath(req('/folders', { headers: { 'next-action': 'abc' } }), false)).toBeNull()
  })
})

describe('refreshSession', () => {
  it('no auth cookie -> signed out with no Supabase call', async () => {
    createServerClient.mockReset()
    const s = await refreshSession(req('/folders', { headers: { cookie: 'theme=dark' } }))
    expect(s).toEqual({ signedIn: false, cookies: [], headers: {} })
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('valid claims -> signedIn', async () => {
    createServerClient.mockReturnValue({ auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) } })
    const s = await refreshSession(req('/folders', { headers: { cookie: 'sb-testref-auth-token=x' } }))
    expect(s.signedIn).toBe(true)
  })
  it('error, empty data and thrown errors -> signed out (never throws)', async () => {
    const impls = [
      async () => ({ data: null, error: new Error('bad') }),
      async () => ({ data: null, error: null }),
      async () => {
        throw new Error('network')
      },
    ]
    for (const impl of impls) {
      createServerClient.mockReturnValue({ auth: { getClaims: impl } })
      const s = await refreshSession(req('/folders', { headers: { cookie: 'sb-testref-auth-token=x' } }))
      expect(s.signedIn).toBe(false)
    }
  })
})
