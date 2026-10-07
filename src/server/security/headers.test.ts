import { describe, expect, it } from 'vitest'
import { appSecurityHeaders, buildAppCsp } from '@/server/security/headers'

const base = { SUPABASE_URL: 'https://testref.supabase.co', CONTENT_ORIGIN: 'https://content.example.app' }

describe('app security headers (02 appendix B-1)', () => {
  it('test / production CSP: nonce, strict-dynamic, frame-src = CONTENT_ORIGIN, no eval / ws, upgrade-insecure-requests', () => {
    for (const APP_ENV of ['test', 'production'] as const) {
      const csp = buildAppCsp({ ...base, APP_ENV }, 'NONCE123')
      expect(csp).toBe(
        [
          `default-src 'self'`,
          `script-src 'self' 'nonce-NONCE123' 'strict-dynamic'`,
          `style-src 'self' 'unsafe-inline'`,
          `img-src 'self' data: blob:`,
          `font-src 'self'`,
          `connect-src 'self' https://testref.supabase.co`,
          `frame-src https://content.example.app`,
          `frame-ancestors 'none'`,
          `form-action 'self'`,
          `base-uri 'none'`,
          `object-src 'none'`,
          'upgrade-insecure-requests',
        ].join('; '),
      )
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('ws:')
    }
  })

  it('local CSP adds unsafe-eval and ws: and omits upgrade-insecure-requests', () => {
    const csp = buildAppCsp({ ...base, APP_ENV: 'local' }, 'N')
    expect(csp).toContain(`'strict-dynamic' 'unsafe-eval'`)
    expect(csp).toContain(`connect-src 'self' https://testref.supabase.co ws:`)
    expect(csp).not.toContain('upgrade-insecure-requests')
  })

  it('returns all 9 headers of B-1 with the expected fixed values', () => {
    const h = appSecurityHeaders({ ...base, APP_ENV: 'production' }, 'N')
    expect(Object.keys(h).sort()).toEqual(
      [
        'Cache-Control',
        'Content-Security-Policy',
        'Cross-Origin-Opener-Policy',
        'Permissions-Policy',
        'Referrer-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-Robots-Tag',
      ].sort(),
    )
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()')
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(h['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(h['Cache-Control']).toBe('private, no-store')
  })
})
