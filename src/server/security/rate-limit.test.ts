import { describe, it, expect } from 'vitest'
import { decideRateLimit, rateLimitKey } from './rate-limit'
import { DECIDE_CASES, KEY_CASES } from '@/tests/fixtures/rate-limit'

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
