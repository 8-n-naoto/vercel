// Rate limiting (06 3.5, 07 5): pure helpers of 07 5.1 plus consumeRateLimit (UPSERT, fail-closed).
import 'server-only'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
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
  | 'ticket:user'
  | 'download:user'

export interface RateLimitParts {
  email?: string
  ip?: string | null
  linkId?: string
  userId?: string
}

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSec: number; writeAudit: boolean }

/** count <= limit is ok. Over the limit: retryAfterSec >= 1, and only the first excess (count === limit + 1) writes an audit log. */
export function decideRateLimit(count: number, limit: number, retryAfter: number): RateLimitDecision {
  // D-020: non-finite count / limit are rejected; retryAfterSec is an integer >= 1 (Retry-After), 60 when retryAfter is not finite.
  const retryAfterSec = Number.isFinite(retryAfter) ? Math.max(1, Math.ceil(retryAfter)) : 60
  if (!Number.isFinite(count) || !Number.isFinite(limit)) return { ok: false, retryAfterSec, writeAudit: false }
  if (count <= limit) return { ok: true }
  return { ok: false, retryAfterSec, writeAudit: count === limit + 1 }
}

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

// isIP() === 6 has already validated the string, so this only needs to handle the valid grammar. Returns 8 groups (0..0xffff).
function expandIPv6(s: string): number[] {
  const toGroups = (part: string): number[] => {
    if (part === '') return []
    const out: number[] = []
    for (const g of part.split(':')) {
      if (g.includes('.')) {
        const [a = 0, b = 0, c = 0, d = 0] = g.split('.').map(Number)
        out.push((a << 8) | b, (c << 8) | d)
      } else {
        out.push(parseInt(g, 16))
      }
    }
    return out
  }
  const idx = s.indexOf('::')
  if (idx < 0) return toGroups(s)
  const head = toGroups(s.slice(0, idx))
  const tail = toGroups(s.slice(idx + 2))
  return [...head, ...new Array<number>(Math.max(0, 8 - head.length - tail.length)).fill(0), ...tail]
}

/**
 * The ip part of rate-limit keys (06 3.5, D-021). IPv4 stays /32; IPv6 is rounded to its /64 ("a:b:c:d::/64", lowercase, no leading zeros);
 * an IPv4-mapped IPv6 address is treated as IPv4. Empty, whitespace-only, zone-id and non-IP values become 'unknown'.
 * Only the key is rounded: request meta, access logs and audit logs keep the raw ip.
 */
export function rateLimitIpPart(ip: string | null | undefined): string {
  const s = (ip ?? '').trim()
  if (s === '' || s.includes('%')) return 'unknown'
  const v = isIP(s)
  if (v === 4) return s // /32 as is (even if isIP accepts an odd form)
  if (v !== 6) return 'unknown'
  const h = expandIPv6(s)
  if (h.length !== 8) return 'unknown'
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    const hi = h[6] ?? 0
    const lo = h[7] ?? 0
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`
}

/** Key layout of 06 3.5. The ip part goes through rateLimitIpPart. Emails are hashed so the key holds no address. */
export function rateLimitKey(rule: RateLimitRuleName, parts: RateLimitParts): string {
  const ip = rateLimitIpPart(parts.ip)
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
    case 'ticket:user':
    case 'download:user':
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
