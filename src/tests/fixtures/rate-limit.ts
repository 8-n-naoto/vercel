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

// Additions outside 07 (T-018, F-003 proposal 8). X-marked IDs never collide with 07 IDs.
export const DECIDE_X_CASES: { id: string; count: number; limit: number; retry: number; expected: RateLimitDecision }[] = [
  { id: 'RL-X01', count: 0, limit: 0, retry: 60, expected: { ok: true } },
  { id: 'RL-X02', count: 1, limit: 0, retry: 60, expected: { ok: false, retryAfterSec: 60, writeAudit: true } },
  { id: 'RL-X03', count: 2, limit: 0, retry: 60, expected: { ok: false, retryAfterSec: 60, writeAudit: false } },
  { id: 'RL-X04', count: 6, limit: 5, retry: -30, expected: { ok: false, retryAfterSec: 1, writeAudit: true } },
  { id: 'RL-X05', count: 6, limit: 5, retry: 0.5, expected: { ok: false, retryAfterSec: 1, writeAudit: true } },
]

export const KEY_X_CASES: { id: string; rule: RateLimitRuleName; parts: RateLimitParts; expected: string }[] = [
  { id: 'RL-X06', rule: 'login:email', parts: { email: '' }, expected: 'login:email:' + sha256hex('') },
  { id: 'RL-X07', rule: 'login:email', parts: {}, expected: 'login:email:' + sha256hex('') },
  { id: 'RL-X08', rule: 'share:ip', parts: { ip: '2001:db8::1' }, expected: 'share:ip:2001:db8::1' },
  { id: 'RL-X09', rule: 'share:ip', parts: {}, expected: 'share:ip:unknown' },
  { id: 'RL-X10', rule: 'share-pw:link-ip', parts: { linkId: 'L', ip: null }, expected: 'share-pw:link-ip:L:unknown' },
  { id: 'RL-X11', rule: 'mutation:user', parts: { userId: 'U' }, expected: 'mutation:user:U' },
]
