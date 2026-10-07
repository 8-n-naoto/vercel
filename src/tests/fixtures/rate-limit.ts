// Test vectors for decideRateLimit / rateLimitKey. Copied one row per case from 07 5.2 (RL-01..RL-07, IDs preserved).
import { createHash } from 'node:crypto'
import type { RateLimitDecision, RateLimitParts, RateLimitRuleName } from '@/server/security/rate-limit'

export const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex')

export const DECIDE_CASES: { id: string; count: number; limit: number; retry: number; expected: RateLimitDecision }[] = [
  { id: 'RL-01', count: 5, limit: 5, retry: 120, expected: { ok: true } },
  { id: 'RL-02', count: 6, limit: 5, retry: 120, expected: { ok: false, retryAfterSec: 120, writeAudit: true } },
  { id: 'RL-03', count: 7, limit: 5, retry: 120, expected: { ok: false, retryAfterSec: 120, writeAudit: false } },
  { id: 'RL-04', count: 121, limit: 120, retry: 0, expected: { ok: false, retryAfterSec: 1, writeAudit: true } },
]

export const KEY_CASES: { id: string; rule: RateLimitRuleName; parts: RateLimitParts; expected: string }[] = [
  { id: 'RL-05', rule: 'login:email', parts: { email: ' Taro@Example.COM ' }, expected: 'login:email:' + sha256hex('taro@example.com') },
  { id: 'RL-06', rule: 'share:ip', parts: { ip: null }, expected: 'share:ip:unknown' },
  { id: 'RL-07', rule: 'share-pw:link-ip', parts: { linkId: 'L', ip: '203.0.113.5' }, expected: 'share-pw:link-ip:L:203.0.113.5' },
]
