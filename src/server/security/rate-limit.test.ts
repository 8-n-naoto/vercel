import { describe, it, expect } from 'vitest'
import { decideRateLimit, rateLimitKey } from './rate-limit'
import { DECIDE_CASES, DECIDE_X_CASES, KEY_CASES, KEY_X_CASES } from '@/tests/fixtures/rate-limit'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('07 5.2 coverage', () => {
  itCoversSpec07('RL', [...DECIDE_CASES, ...KEY_CASES].map((c) => c.id), { integrationFrom: 8 })
})

describe('decideRateLimit (07 5.2)', () => {
  it.each(DECIDE_CASES)('$id', ({ count, limit, retry, expected }) => {
    expect(decideRateLimit(count, limit, retry)).toEqual(expected)
  })
})

describe('rateLimitKey (07 5.2)', () => {
  it.each(KEY_CASES)('$id', ({ rule, parts, expected }) => {
    expect(rateLimitKey(rule, parts)).toBe(expected)
  })
})

describe('boundaries outside 07 (T-018)', () => {
  it.each(DECIDE_X_CASES)('$id decideRateLimit', ({ count, limit, retry, expected }) => {
    expect(decideRateLimit(count, limit, retry)).toEqual(expected)
  })
  it.each(KEY_X_CASES)('$id rateLimitKey', ({ rule, parts, expected }) => {
    expect(rateLimitKey(rule, parts)).toBe(expected)
  })
  // Judgement requested in the T-018 report: the implementation returns a non-integer / NaN retryAfterSec.
  it.todo('RL-X12 decideRateLimit: retry 1.5 should give an integer retryAfterSec (Retry-After header)')
  it.todo('RL-X13 decideRateLimit: retry NaN should not produce a NaN retryAfterSec')
  it.todo('RL-X14 rateLimitKey: empty-string ip should map to unknown (currently the key ends with an empty ip)')
  it.todo('RL-X15 rateLimitKey: linkId containing ":" can collide with another (linkId, ip) pair; linkId must be a UUID at the call site')
})
