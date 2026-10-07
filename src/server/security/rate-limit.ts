// Rate limiting (06 3.5, 07 5): pure helpers of 07 5.1 plus consumeRateLimit (UPSERT, fail-closed).
import 'server-only'
import { createHash } from 'node:crypto'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { recordStandalone } from '@/server/services/audit'
import { incrementRateLimit } from '@/server/services/rate-limit-store'

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

export interface ConsumeRule {
  name: string
  key: string
  limit: number
  windowSec: number
  /** Audit action written on the first excess (default 'security.rate_limited'). */
  auditAction?: 'auth.login_rate_limited'
}

/**
 * 06 3.5: one UPSERT (07 5.1), committed immediately regardless of the business outcome. Fail-closed: any DB error rejects with INTERNAL.
 * The first excess (count === limit + 1) writes one audit row with { rule: name }; the key itself is never recorded.
 */
export async function consumeRateLimit(rule: ConsumeRule, ctx: ServiceContext): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  let hit: { count: number; retryAfter: number }
  try {
    hit = await incrementRateLimit(rule.key, rule.windowSec)
  } catch (e) {
    console.error(JSON.stringify({ event: 'rate_limit.db_error', rule: rule.name, requestId: ctx.requestMeta.requestId, error: e instanceof Error ? e.name : 'unknown' }))
    throw appError('INTERNAL', 'common.internal', { requestId: ctx.requestMeta.requestId, params: { requestId: ctx.requestMeta.requestId } })
  }
  const d = decideRateLimit(hit.count, rule.limit, hit.retryAfter)
  if (d.ok) return { ok: true }
  if (d.writeAudit) {
    try {
      await recordStandalone(ctx, { action: rule.auditAction ?? 'security.rate_limited', metadata: { rule: rule.name } })
    } catch (e) {
      // The request is rejected either way; a failed audit row must not turn RATE_LIMITED into INTERNAL.
      console.error(JSON.stringify({ event: 'rate_limit.audit_failed', rule: rule.name, requestId: ctx.requestMeta.requestId, error: e instanceof Error ? e.name : 'unknown' }))
    }
  }
  return { ok: false, retryAfterSec: d.retryAfterSec }
}
