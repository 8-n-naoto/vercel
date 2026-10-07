// Session handling for src/proxy.ts (02 2.6 steps 4 and 6). UX only: the proxy is never an authorization basis;
// every page and action still calls requireUser / requireAdmin.
import 'server-only'
import type { NextRequest } from 'next/server'
import { PUBLIC_PAGES } from '@/server/page-registry'
import { authCookieBaseName, createSupabaseProxyClient, isAuthCookieName, type PendingCookie } from '@/server/auth/supabase-server'

export interface ProxySession {
  /** a verified session exists (the profile is not looked up here) */
  signedIn: boolean
  cookies: PendingCookie[]
  headers: Record<string, string>
}

/** Refreshes an expiring access token (02 2.6 step 4). Does nothing, with no network call, when no auth cookie is present. */
export async function refreshSession(request: NextRequest): Promise<ProxySession> {
  const sink: ProxySession = { signedIn: false, cookies: [], headers: {} }
  const base = authCookieBaseName()
  const all = request.cookies.getAll().map(({ name, value }) => ({ name, value }))
  if (!all.some((c) => isAuthCookieName(c.name, base))) return sink
  try {
    const supabase = createSupabaseProxyClient(all, sink)
    const { data, error } = await supabase.auth.getClaims()
    sink.signedIn = error === null && data !== null && typeof data.claims.sub === 'string'
  } catch {
    sink.signedIn = false // a broken session is treated as signed out; the page decides with requireUser
  }
  return sink
}

const PUBLIC_PATTERNS = PUBLIC_PAGES.map((p) => new RegExp(`^${p.replace(/\[[^/\]]+\]/g, '[^/]+')}$`))

/** Paths that are reachable without a session. /api/* and /raw/* have their own authentication (06 10) and never redirect. */
export function isPublicPath(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return p.startsWith('/api/') || PUBLIC_PATTERNS.some((re) => re.test(p))
}

/** `next` must be a relative path: starts with a single "/", no "//" and no backslash (open redirect, 02 5.1.3). */
export function safeNextPath(path: string): string | null {
  if (path.length > 2048 || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  return path
}

/**
 * The login redirect target (02 2.6 step 6), or null when the request must pass. Only page navigations are redirected:
 * a Server Action POST (Next-Action header) gets ActionResult UNAUTHENTICATED from defineAction instead.
 */
export function loginRedirectPath(request: NextRequest, signedIn: boolean): string | null {
  if (signedIn) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  if (request.headers.has('next-action')) return null
  const { pathname, search } = request.nextUrl
  if (isPublicPath(pathname)) return null
  const next = safeNextPath(pathname + search)
  return next === null ? '/login' : `/login?next=${encodeURIComponent(next)}`
}
