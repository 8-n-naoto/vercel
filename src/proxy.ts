// Next 16: the file is proxy.ts and the export is proxy (middleware.ts is deprecated). Host routing: 02 2.6 steps 1-3 and 5.
// Step 4 (session refresh with @supabase/ssr) and step 6 (login redirect, UX only) live in server/auth/proxy-session.ts. Proxy is not an authorization basis.
import { NextResponse, type NextRequest } from 'next/server'
import { loginRedirectPath, refreshSession } from '@/server/auth/proxy-session'
import { getConfig } from '@/server/config'
import { appSecurityHeaders, rawErrorHeaders } from '@/server/security/headers'

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const cfg = getConfig()
  const host = request.headers.get('host') ?? ''
  const appHost = new URL(cfg.APP_ORIGIN).host
  const contentHost = new URL(cfg.CONTENT_ORIGIN).host
  const path = request.nextUrl.pathname

  // 1. Unknown host -> 404 (also blocks per-deployment *.vercel.app URLs; see 04 6.3)
  if (host !== appHost && host !== contentHost) return notFound()

  // 2. Content origin: only /raw/ is served. No auth processing, no app headers (the route sets its own).
  if (host === contentHost) {
    if (!path.startsWith('/raw/')) return new NextResponse(null, { status: 404, headers: rawErrorHeaders() })
    return NextResponse.next()
  }

  // 3. App origin: /raw/ must not exist here.
  if (path.startsWith('/raw/')) return notFound()

  // 4. Refresh the session cookies. They are applied to the forwarded request (Server Components see the new token) and to the response.
  const session = await refreshSession(request)
  for (const c of session.cookies) request.cookies.set(c.name, c.value)

  // 5. App security headers with a per-request CSP nonce.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const headers = appSecurityHeaders(cfg, nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce) // read by layout.tsx for <Script nonce>
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy'] ?? '') // Next reads the nonce from here
  // 6. Not signed in on a page outside PUBLIC_PAGES -> /login?next=<relative path> (UX only; pages still call requireUser)
  const login = loginRedirectPath(request, session.signedIn)
  const response = login === null ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.redirect(new URL(login, request.url))
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v)
  for (const c of session.cookies) response.cookies.set(c.name, c.value, c.options)
  for (const [k, v] of Object.entries(session.headers)) response.headers.set(k, v) // Cache-Control: no-store when cookies were written
  return response
}

export const config = {
  // Static assets and image files are excluded. /api and Server Action paths are NOT excluded: host checks and headers must apply.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
