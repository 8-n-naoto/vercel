import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { config, proxy } from '@/proxy'

// src/tests/setup.ts: APP_ORIGIN=http://localhost:3000, CONTENT_ORIGIN=http://127.0.0.1:3000
const call = async (host: string, path: string) => await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host } }))

describe('proxy host routing (02 2.6, 04 8.2 #3-#6)', () => {
  it('unknown host -> 404', async () => {
    expect((await call('unknown.example', '/')).status).toBe(404)
    expect((await call('localhost', '/')).status).toBe(404) // port differs
    expect((await call('', '/')).status).toBe(404)
  })

  it('app origin: /raw/* -> 404, other paths pass with the B-1 headers', async () => {
    expect((await call('localhost:3000', '/raw/x')).status).toBe(404)
    const res = await call('localhost:3000', '/login')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'X-Robots-Tag', 'Cache-Control']) {
      expect(res.headers.get(name), name).toBeTruthy()
    }
  })

  it('app origin: CSP carries a per-request nonce and frame-src = CONTENT_ORIGIN; the nonce is forwarded to the page', async () => {
    const a = await call('localhost:3000', '/login')
    const b = await call('localhost:3000', '/login')
    const csp = a.headers.get('Content-Security-Policy') ?? ''
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).toContain('frame-src http://127.0.0.1:3000;')
    expect(/'nonce-([^']+)'/.exec(b.headers.get('Content-Security-Policy') ?? '')?.[1]).not.toBe(nonce)
    // NextResponse.next({ request: { headers } }) exposes overridden request headers as x-middleware-request-*
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
  })

  it('content origin: only /raw/* passes (without app headers); / and /login -> 404', async () => {
    expect((await call('127.0.0.1:3000', '/')).status).toBe(404)
    expect((await call('127.0.0.1:3000', '/login')).status).toBe(404)
    expect((await call('127.0.0.1:3000', '/api/health')).status).toBe(404)
    const res = await call('127.0.0.1:3000', '/raw/abc')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
    expect(res.headers.get('X-Frame-Options')).toBeNull()
  })

  it('matcher excludes only static assets (not /api)', async () => {
    const re = new RegExp(`^${config.matcher[0]}$`)
    expect(re.test('/api/health')).toBe(true)
    expect(re.test('/_next/static/chunk.js')).toBe(false)
    expect(re.test('/_next/image')).toBe(false)
    expect(re.test('/favicon.ico')).toBe(false)
  })
})

describe('proxy login redirect (02 2.6 step 6, UX only)', () => {
  it('signed out on an app page -> 307 to /login?next=<relative path> with the security headers', async () => {
    const res = await call('localhost:3000', '/folders?tab=1')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login?next=%2Ffolders%3Ftab%3D1')
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
  })
  it('public pages and /api are not redirected', async () => {
    for (const p of ['/login', '/s/abc', '/invite/abc', '/reset/abc', '/api/health']) expect((await call('localhost:3000', p)).status, p).toBe(200)
  })
  it('the content origin never redirects or touches auth', async () => {
    expect((await call('127.0.0.1:3000', '/raw/abc')).status).toBe(200)
  })
})
