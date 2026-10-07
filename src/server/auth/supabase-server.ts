// Server-side Supabase client over Next cookies (02 5.1.1 / 5.1.2). The browser never creates a Supabase client.
// Cookie attributes are forced here (04 11 D9): @supabase/ssr 0.12.7 defaults to httpOnly: false and no secure flag.
import 'server-only'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { refFromSupabaseUrl } from '@/lib/env-guard'
import { getConfig } from '@/server/config'

/** Base name of the auth cookie, `sb-<project-ref>-auth-token` (the @supabase/ssr default). Chunks are `<base>.0`, `<base>.1` ... */
export function authCookieBaseName(supabaseUrl: string = getConfig().SUPABASE_URL): string {
  const ref = refFromSupabaseUrl(supabaseUrl)
  if (ref === null) throw new Error('SUPABASE_URL is not a valid URL')
  return `sb-${ref}-auth-token`
}

/** The base cookie, its chunks and the PKCE verifier cookies that @supabase/ssr derives from the same storage key. */
export function isAuthCookieName(name: string, base: string): boolean {
  return name === base || name.startsWith(`${base}.`) || name.startsWith(`${base}-code-verifier`)
}

/**
 * Forces the attributes of 02 5.1.2: HttpOnly, SameSite=Lax, Path=/, no Domain, Secure when the app origin is https,
 * Max-Age capped at SESSION_MAX_AGE_DAYS (a removal, maxAge <= 0, is kept as is).
 */
export function enforceCookieOptions(
  options: CookieOptions,
  env: { secure: boolean; maxAgeCapSec: number },
): CookieOptions {
  const removal = options.maxAge !== undefined && options.maxAge <= 0
  const maxAge = removal ? 0 : Math.min(options.maxAge ?? env.maxAgeCapSec, env.maxAgeCapSec)
  // domain is dropped on purpose: host-only cookies are never sent to the content origin
  const { domain: _domain, ...rest } = options
  void _domain
  return { ...rest, path: '/', httpOnly: true, sameSite: 'lax', secure: env.secure, maxAge }
}

export function cookieEnv(): { secure: boolean; maxAgeCapSec: number } {
  const cfg = getConfig()
  // Config guarantees https outside APP_ENV=local, so this is false only for http://localhost.
  return { secure: cfg.APP_ORIGIN.startsWith('https://'), maxAgeCapSec: cfg.SESSION_MAX_AGE_DAYS * 86_400 }
}

export interface PendingCookie {
  name: string
  value: string
  options: CookieOptions
}

/** Client for Server Components, Server Actions and Route Handlers. One per request (never share it across requests). */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cfg = getConfig()
  const store = await cookies()
  const env = cookieEnv()
  return createServerClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: authCookieBaseName(cfg.SUPABASE_URL) },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, enforceCookieOptions(options, env))
        } catch {
          // Server Components cannot write cookies (Next throws). The refreshed session is written by the proxy
          // (src/proxy.ts), so ignoring the failure here is safe. Server Actions and Route Handlers can write.
        }
      },
    },
  })
}

/**
 * Proxy variant (02 2.6 step 4): reads cookies from the request and collects what @supabase/ssr wants to write, so that
 * the proxy can apply it to both the forwarded request (for Server Components) and the response (for the browser).
 */
export function createSupabaseProxyClient(
  requestCookies: { name: string; value: string }[],
  sink: { cookies: PendingCookie[]; headers: Record<string, string> },
): SupabaseClient {
  const cfg = getConfig()
  const env = cookieEnv()
  return createServerClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: authCookieBaseName(cfg.SUPABASE_URL) },
    cookies: {
      getAll: () => requestCookies,
      setAll: (toSet, headers) => {
        for (const { name, value, options } of toSet) sink.cookies.push({ name, value, options: enforceCookieOptions(options, env) })
        Object.assign(sink.headers, headers) // Cache-Control: private, no-store (a CDN must not cache a response with a session)
      },
    },
  })
}
