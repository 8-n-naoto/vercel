// Reads the facts that requireUser decides on: the verified claims and the profile row (02 5.1.4).
// Lives in auth/ because authz/ may not import repositories (eslint.config.mjs); the decision itself is decideSession.
import 'server-only'
import { createSupabaseServerClient } from '@/server/auth/supabase-server'
import { findProfileById, type SessionProfile } from '@/server/repositories/profiles'

export interface SessionFacts {
  sub: string | null
  authTimeSec: number | null
  profile: SessionProfile | null
}

/**
 * The only place that knows where the authentication time comes from (04 11 D3, 02 5.1.4 main plan: the timestamp of the
 * password entry in `amr`). `iat` is never used: it changes on every token refresh. null means "unknown", which
 * decideSession treats as UNAUTHENTICATED.
 * Replacement point if D3 shows that amr carries no timestamp: this function only (the HMAC cookie alternative, 02 5.1.4).
 * With several password entries the latest one wins (a later password authentication is a real authentication).
 */
export function extractAuthTimeSec(claims: { amr?: unknown }): number | null {
  const amr = claims.amr
  if (!Array.isArray(amr)) return null
  let latest: number | null = null
  for (const entry of amr as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue // string[] form (RFC 8176) has no timestamp
    const method: unknown = Reflect.get(entry, 'method')
    const timestamp: unknown = Reflect.get(entry, 'timestamp')
    if (method !== 'password' || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) continue
    if (latest === null || timestamp > latest) latest = timestamp
  }
  return latest
}

/** getClaims() verifies the JWT (local verification with asymmetric keys). Errors mean "no usable session". DB errors propagate. */
export async function loadSessionFacts(): Promise<SessionFacts> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error !== null || data === null || typeof data.claims.sub !== 'string' || data.claims.sub === '') {
    return { sub: null, authTimeSec: null, profile: null }
  }
  const sub = data.claims.sub
  const profile = (await findProfileById(sub)) ?? null
  return { sub, authTimeSec: extractAuthTimeSec(data.claims), profile }
}
