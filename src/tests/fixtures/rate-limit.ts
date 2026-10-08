// Test vectors for decideRateLimit / rateLimitKey. Copied one row per case from 07 5.2 (RL-01..RL-07, RL-12..RL-28, IDs preserved).
import { createHash } from 'node:crypto'
import type { RateLimitDecision, RateLimitParts, RateLimitRuleName } from '@/server/security/rate-limit'

export const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex')

export const DECIDE_CASES: { id: string; count: number; limit: number; retry: number; expected: RateLimitDecision }[] = [
  { id: 'RL-01', count: 5, limit: 5, retry: 120, expected: { ok: true } },
  { id: 'RL-02', count: 6, limit: 5, retry: 120, expected: { ok: false, retryAfterSec: 120, writeAudit: true } },
  { id: 'RL-03', count: 7, limit: 5, retry: 120, expected: { ok: false, retryAfterSec: 120, writeAudit: false } },
  { id: 'RL-04', count: 121, limit: 120, retry: 0, expected: { ok: false, retryAfterSec: 1, writeAudit: true } },
  { id: 'RL-27', count: 30, limit: 30, retry: 45, expected: { ok: true } },
  { id: 'RL-28', count: 31, limit: 30, retry: 45, expected: { ok: false, retryAfterSec: 45, writeAudit: true } },
]

export const KEY_CASES: { id: string; rule: RateLimitRuleName; parts: RateLimitParts; expected: string }[] = [
  { id: 'RL-05', rule: 'login:email', parts: { email: ' Taro@Example.COM ' }, expected: 'login:email:' + sha256hex('taro@example.com') },
  { id: 'RL-06', rule: 'share:ip', parts: { ip: null }, expected: 'share:ip:unknown' },
  { id: 'RL-07', rule: 'share-pw:link-ip', parts: { linkId: 'L', ip: '203.0.113.5' }, expected: 'share-pw:link-ip:L:203.0.113.5' },
  // 06 3.5 ip part normalization (D-021) and ticket:user (D-022).
  { id: 'RL-12', rule: 'login:ip', parts: { ip: '203.0.113.5' }, expected: 'login:ip:203.0.113.5' },
  { id: 'RL-13', rule: 'login:ip', parts: { ip: '2001:db8::1' }, expected: 'login:ip:2001:db8:0:0::/64' },
  { id: 'RL-14', rule: 'login:ip', parts: { ip: '2001:db8::2' }, expected: 'login:ip:2001:db8:0:0::/64' },
  { id: 'RL-15', rule: 'login:ip', parts: { ip: '2001:DB8:0000:0000:ffff:1:2:3' }, expected: 'login:ip:2001:db8:0:0::/64' },
  { id: 'RL-16', rule: 'login:ip', parts: { ip: '2001:db8:0:1::1' }, expected: 'login:ip:2001:db8:0:1::/64' },
  { id: 'RL-17', rule: 'token:ip', parts: { ip: '2001:db8:1:2:3:4:5:6' }, expected: 'token:ip:2001:db8:1:2::/64' },
  { id: 'RL-18', rule: 'raw:ip', parts: { ip: '::1' }, expected: 'raw:ip:0:0:0:0::/64' },
  { id: 'RL-19', rule: 'raw:ip', parts: { ip: '1::' }, expected: 'raw:ip:1:0:0:0::/64' },
  { id: 'RL-20', rule: 'share:ip', parts: { ip: '::ffff:203.0.113.5' }, expected: 'share:ip:203.0.113.5' },
  { id: 'RL-21', rule: 'share:ip', parts: { ip: '::ffff:cb00:7105' }, expected: 'share:ip:203.0.113.5' },
  { id: 'RL-22', rule: 'share:ip', parts: { ip: '2001:db8::1.2.3.4' }, expected: 'share:ip:2001:db8:0:0::/64' },
  { id: 'RL-23', rule: 'share-pw:link-ip', parts: { linkId: 'L', ip: '2001:db8::1' }, expected: 'share-pw:link-ip:L:2001:db8:0:0::/64' },
  { id: 'RL-24', rule: 'share:ip', parts: { ip: 'fe80::1%eth0' }, expected: 'share:ip:unknown' },
  { id: 'RL-25a', rule: 'share:ip', parts: { ip: 'not-an-ip' }, expected: 'share:ip:unknown' },
  { id: 'RL-25b', rule: 'share:ip', parts: { ip: '2001:db8::g' }, expected: 'share:ip:unknown' },
  { id: 'RL-26', rule: 'ticket:user', parts: { userId: 'U' }, expected: 'ticket:user:U' },
  { id: 'RL-31', rule: 'download:user', parts: { userId: 'U' }, expected: 'download:user:U' },
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
  { id: 'RL-X08', rule: 'share:ip', parts: { ip: '2001:db8::1' }, expected: 'share:ip:2001:db8:0:0::/64' },
  { id: 'RL-X09', rule: 'share:ip', parts: {}, expected: 'share:ip:unknown' },
  { id: 'RL-X10', rule: 'share-pw:link-ip', parts: { linkId: 'L', ip: null }, expected: 'share-pw:link-ip:L:unknown' },
  { id: 'RL-X11', rule: 'mutation:user', parts: { userId: 'U' }, expected: 'mutation:user:U' },
]
