// Next 16: the file is proxy.ts and the export is proxy (middleware.ts is deprecated). Host routing: 02 2.6 steps 1-3 and 5.
// Session refresh (step 4) and the login redirect (step 6) are added with @supabase/ssr in phase 1. Proxy is not an authorization basis.
import { NextResponse, type NextRequest } from 'next/server'
import { getConfig } from '@/server/config'
import { appSecurityHeaders } from '@/server/security/headers'

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

export function proxy(request: NextRequest): NextResponse {
  const cfg = getConfig()
  const host = request.headers.get('host') ?? ''
  const appHost = new URL(cfg.APP_ORIGIN).host
  const contentHost = new URL(cfg.CONTENT_ORIGIN).host
  const path = request.nextUrl.pathname

  // 1. Unknown host -> 404 (also blocks per-deployment *.vercel.app URLs; see 04 6.3)
  if (host !== appHost && host !== contentHost) return notFound()

  // 2. Content origin: only /raw/ is served. No auth processing, no app headers (the route sets its own).
  if (host === contentHost) {
    if (!path.startsWith('/raw/')) return notFound()
    return NextResponse.next()
  }

  // 3. App origin: /raw/ must not exist here.
  if (path.startsWith('/raw/')) return notFound()

  // 5. App security headers with a per-request CSP nonce.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const headers = appSecurityHeaders(cfg, nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce) // read by layout.tsx for <Script nonce>
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy'] ?? '') // Next reads the nonce from here
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v)
  return response
}

export const config = {
  // Static assets and image files are excluded. /api and Server Action paths are NOT excluded: host checks and headers must apply.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
