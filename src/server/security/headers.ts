// Response headers: app origin (02 appendix B-1) and content origin /raw/[ticket] (B-2 view, B-3 download).
import 'server-only'
import type { Config } from '@/server/config'

type HeaderConfig = Pick<Config, 'APP_ENV' | 'SUPABASE_URL' | 'CONTENT_ORIGIN'>

export function buildAppCsp(cfg: HeaderConfig, nonce: string): string {
  const isLocal = cfg.APP_ENV === 'local'
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isLocal ? ` 'unsafe-eval'` : ''}`, // eval is needed by Next dev tooling only
    `style-src 'self' 'unsafe-inline'`, // shadcn/ui (Radix) inline styles (02 App B-1)
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${cfg.SUPABASE_URL}${isLocal ? ' ws:' : ''}`,
    `frame-src ${cfg.CONTENT_ORIGIN}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
  ]
  if (!isLocal) directives.push('upgrade-insecure-requests') // http://localhost must stay usable
  return directives.join('; ')
}

export function appSecurityHeaders(cfg: HeaderConfig, nonce: string): Record<string, string> {
  return {
    'Content-Security-Policy': buildAppCsp(cfg, nonce),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'private, no-store',
  }
}

// ---- Content origin /raw/[ticket] (02 appendix B-2 / B-3, 06 10.1) ----

const NO_STORE_PRIVATE = 'private, no-store, max-age=0'
const HSTS = 'max-age=63072000; includeSubDomains'
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()'
const ROBOTS_NO_ARCHIVE = 'noindex, nofollow, noarchive'

/** B-2 CSP. `frame-ancestors` is the app origin only; connect-src / form-action / frame-src are 'none'. */
export function buildViewCsp(cfg: Pick<Config, 'APP_ORIGIN'>): string {
  return [
    'sandbox allow-scripts',
    `default-src 'none'`,
    `script-src 'unsafe-inline' 'unsafe-eval' data: blob:`,
    `style-src 'unsafe-inline' data:`,
    `img-src data: blob:`,
    `font-src data:`,
    `media-src data: blob:`,
    `worker-src blob:`,
    `connect-src 'none'`,
    `form-action 'none'`,
    `frame-src 'none'`,
    `base-uri 'none'`,
    `frame-ancestors ${cfg.APP_ORIGIN}`,
  ].join('; ')
}

/** B-2 (purpose = view). No Content-Disposition, never Set-Cookie. `charset` is files.charset. */
export function viewResponseHeaders(cfg: Pick<Config, 'APP_ORIGIN'>, charset: string): Record<string, string> {
  return {
    'Content-Type': `text/html; charset=${charset}`,
    'Content-Security-Policy': buildViewCsp(cfg),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': NO_STORE_PRIVATE,
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Strict-Transport-Security': HSTS,
    'X-Robots-Tag': ROBOTS_NO_ARCHIVE,
  }
}

/** ASCII fallback for `filename="..."`: every code point that is non-ASCII, a double quote, a backslash or a control character becomes `_`. */
export function asciiFilename(name: string): string {
  let out = ''
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0
    out += c < 0x20 || c > 0x7e || c === 0x22 || c === 0x5c ? '_' : ch // 0x22 = double quote, 0x5c = backslash
  }
  return out
}

/** RFC 5987 value for `filename*=UTF-8''...`: encodeURIComponent plus `'()*` (06 10.1). Lone surrogates are replaced first so it cannot throw. */
export function rfc5987Filename(name: string): string {
  return encodeURIComponent(name.toWellFormed()).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function attachmentDisposition(originalFilename: string): string {
  return `attachment; filename="${asciiFilename(originalFilename)}"; filename*=UTF-8''${rfc5987Filename(originalFilename)}`
}

/** B-3 (purpose = download). */
export function downloadResponseHeaders(originalFilename: string): Record<string, string> {
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': attachmentDisposition(originalFilename),
    'Content-Security-Policy': `sandbox; default-src 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': NO_STORE_PRIVATE,
    'X-Robots-Tag': ROBOTS_NO_ARCHIVE,
  }
}

/** 404 / 403 / 405 / 429 / 500 / 502 of /raw: fixed English body, no hint of the file's existence (06 10.1). */
export function rawErrorHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': ROBOTS_NO_ARCHIVE,
    'X-Content-Type-Options': 'nosniff',
  }
}
