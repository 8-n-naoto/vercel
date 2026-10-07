// Response headers of the app origin (02 appendix B-1). B-2 / B-3 (/raw/[ticket]) are added in WP-5.2.
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
