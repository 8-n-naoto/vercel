// Phase 0 stub of consumeRateLimit (WP-1.4, 06 3.5, 07 5) plus the pure helpers of 07 5.1.
import 'server-only'
import { createHash } from 'node:crypto'
import type { ServiceContext } from '@/server/actions/define-action'

export type RateLimitRuleName =
  | 'login:email'
  | 'login:ip'
  | 'token:ip'
  | 'share:ip'
  | 'share-pw:link'
  | 'share-pw:link-ip'
  | 'raw:ip'
  | 'mutation:user'

export interface RateLimitParts {
  email?: string
  ip?: string | null
  linkId?: string
  userId?: string
}

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSec: number; writeAudit: boolean }

/** count <= limit is ok. Over the limit: retryAfterSec >= 1, and only the first excess (count === limit + 1) writes an audit log. */
export function decideRateLimit(count: number, limit: number, retryAfter: number): RateLimitDecision {
  if (count <= limit) return { ok: true }
  return { ok: false, retryAfterSec: Math.max(1, retryAfter), writeAudit: count === limit + 1 }
}

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** Key layout of 06 3.5. A null or missing ip becomes 'unknown'. Emails are hashed so the key holds no address. */
export function rateLimitKey(rule: RateLimitRuleName, parts: RateLimitParts): string {
  const ip = parts.ip ?? 'unknown'
  switch (rule) {
    case 'login:email':
      return `${rule}:${sha256hex((parts.email ?? '').trim().toLowerCase())}`
    case 'login:ip':
    case 'token:ip':
    case 'share:ip':
    case 'raw:ip':
      return `${rule}:${ip}`
    case 'share-pw:link':
      return `${rule}:${parts.linkId ?? ''}`
    case 'share-pw:link-ip':
      return `${rule}:${parts.linkId ?? ''}:${ip}`
    case 'mutation:user':
      return `${rule}:${parts.userId ?? ''}`
  }
}

export async function consumeRateLimit(
  rule: { name: string; key: string; limit: number; windowSec: number },
  ctx: ServiceContext,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  void rule
  void ctx
  return { ok: true } // no-op until app.rate_limits exists
}
