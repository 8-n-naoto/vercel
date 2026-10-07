import { describe, expect, it } from 'vitest'
import { appSecurityHeaders, asciiFilename, attachmentDisposition, buildAppCsp, buildViewCsp, downloadResponseHeaders, rawErrorHeaders, rfc5987Filename, viewResponseHeaders } from '@/server/security/headers'

const BS = String.fromCharCode(92) // backslash
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

describe('content origin headers (02 appendix B-2 view, one assertion per row)', () => {
  const h = viewResponseHeaders({ APP_ORIGIN: 'https://app.example.app' }, 'shift_jis')

  it('returns exactly the 8 headers of B-2', () => {
    expect(Object.keys(h).sort()).toEqual(
      ['Cache-Control', 'Content-Security-Policy', 'Content-Type', 'Permissions-Policy', 'Referrer-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Robots-Tag'].sort(),
    )
  })
  it('Content-Type carries files.charset', () => {
    expect(h['Content-Type']).toBe('text/html; charset=shift_jis')
    expect(viewResponseHeaders({ APP_ORIGIN: 'https://a' }, 'utf-8')['Content-Type']).toBe('text/html; charset=utf-8')
  })
  it('Content-Security-Policy is the B-2 string with frame-ancestors = APP_ORIGIN', () => {
    expect(h['Content-Security-Policy']).toBe(
      `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors https://app.example.app`,
    )
    expect(buildViewCsp({ APP_ORIGIN: 'https://x.example' })).toMatch(/frame-ancestors https:\/\/x\.example$/)
    expect(h['Content-Security-Policy']).not.toContain('allow-same-origin')
  })
  it('fixed values of the remaining rows', () => {
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['Cache-Control']).toBe('private, no-store, max-age=0')
    expect(h['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()')
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
    expect(h['X-Robots-Tag']).toBe('noindex, nofollow, noarchive')
  })
  it('has no Content-Disposition and no Set-Cookie', () => {
    const lower = Object.keys(h).map((k) => k.toLowerCase())
    expect(lower).not.toContain('content-disposition')
    expect(lower).not.toContain('set-cookie')
  })
})

describe('content origin headers (02 appendix B-3 download)', () => {
  const h = downloadResponseHeaders('レポート "a".html')

  it('returns exactly the 7 headers of B-3', () => {
    expect(Object.keys(h).sort()).toEqual(
      ['Cache-Control', 'Content-Disposition', 'Content-Security-Policy', 'Content-Type', 'Referrer-Policy', 'X-Content-Type-Options', 'X-Robots-Tag'].sort(),
    )
  })
  it('fixed values row by row', () => {
    expect(h['Content-Type']).toBe('application/octet-stream')
    expect(h['Content-Security-Policy']).toBe(`sandbox; default-src 'none'`)
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['Cache-Control']).toBe('private, no-store, max-age=0')
    expect(h['X-Robots-Tag']).toBe('noindex, nofollow, noarchive')
  })
  it('Content-Disposition has the ASCII fallback and the RFC 5987 name', () => {
    expect(h['Content-Disposition']).toBe(`attachment; filename="____ _a_.html"; filename*=UTF-8''%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88%20%22a%22.html`)
  })
  it('has no Set-Cookie', () => {
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('set-cookie')
  })
})

describe('Content-Disposition filename rules (06 10.1)', () => {
  it('asciiFilename replaces non-ASCII (one per code point), quote, backslash and control characters with _', () => {
    expect(asciiFilename('plain-1.html')).toBe('plain-1.html')
    expect(asciiFilename('a"b' + BS + 'c')).toBe('a_b_c')
    expect(asciiFilename('日本.html')).toBe('__.html')
    expect(asciiFilename('😀.html')).toBe('_.html')
    expect(asciiFilename('a\tb\nc\x7fd\u0000')).toBe('a_b_c_d_')
    expect(asciiFilename("it's (1).html")).toBe("it's (1).html")
  })
  it("rfc5987Filename percent-encodes ' ( ) * as well as everything encodeURIComponent encodes", () => {
    expect(rfc5987Filename("it's (1)*.html")).toBe('it%27s%20%281%29%2A.html')
    expect(rfc5987Filename('日本.html')).toBe('%E6%97%A5%E6%9C%AC.html')
    expect(rfc5987Filename('a"b' + BS + 'c;d')).toBe('a%22b%5Cc%3Bd')
  })
  it('a lone surrogate does not throw', () => {
    expect(rfc5987Filename('a\ud800b')).toBe('a%EF%BF%BDb')
  })
  it('attachmentDisposition joins both forms', () => {
    expect(attachmentDisposition('x.html')).toBe(`attachment; filename="x.html"; filename*=UTF-8''x.html`)
  })
})

describe('raw error headers', () => {
  it('plain text, no-store, noindex', () => {
    const h = rawErrorHeaders()
    expect(h['Content-Type']).toBe('text/plain; charset=utf-8')
    expect(h['Cache-Control']).toBe('no-store')
    expect(h['X-Robots-Tag']).toBe('noindex, nofollow, noarchive')
  })
})
