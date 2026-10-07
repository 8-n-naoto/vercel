import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { config, proxy } from '@/proxy'

// src/tests/setup.ts: APP_ORIGIN=http://localhost:3000, CONTENT_ORIGIN=http://127.0.0.1:3000
const call = (host: string, path: string) => proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host } }))

describe('proxy host routing (02 2.6, 04 8.2 #3-#6)', () => {
  it('unknown host -> 404', () => {
    expect(call('unknown.example', '/').status).toBe(404)
    expect(call('localhost', '/').status).toBe(404) // port differs
    expect(call('', '/').status).toBe(404)
  })

  it('app origin: /raw/* -> 404, other paths pass with the B-1 headers', () => {
    expect(call('localhost:3000', '/raw/x').status).toBe(404)
    const res = call('localhost:3000', '/login')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'X-Robots-Tag', 'Cache-Control']) {
      expect(res.headers.get(name), name).toBeTruthy()
    }
  })

  it('app origin: CSP carries a per-request nonce and frame-src = CONTENT_ORIGIN; the nonce is forwarded to the page', () => {
    const a = call('localhost:3000', '/')
    const b = call('localhost:3000', '/')
    const csp = a.headers.get('Content-Security-Policy') ?? ''
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).toContain('frame-src http://127.0.0.1:3000;')
    expect(/'nonce-([^']+)'/.exec(b.headers.get('Content-Security-Policy') ?? '')?.[1]).not.toBe(nonce)
    // NextResponse.next({ request: { headers } }) exposes overridden request headers as x-middleware-request-*
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
  })

  it('content origin: only /raw/* passes (without app headers); / and /login -> 404', () => {
    expect(call('127.0.0.1:3000', '/').status).toBe(404)
    expect(call('127.0.0.1:3000', '/login').status).toBe(404)
    expect(call('127.0.0.1:3000', '/api/health').status).toBe(404)
    const res = call('127.0.0.1:3000', '/raw/abc')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
    expect(res.headers.get('X-Frame-Options')).toBeNull()
  })

  it('matcher excludes only static assets (not /api)', () => {
    const re = new RegExp(`^${config.matcher[0]}$`)
    expect(re.test('/api/health')).toBe(true)
    expect(re.test('/_next/static/chunk.js')).toBe(false)
    expect(re.test('/_next/image')).toBe(false)
    expect(re.test('/favicon.ico')).toBe(false)
  })
})
