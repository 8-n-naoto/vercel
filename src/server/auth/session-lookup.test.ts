import { describe, expect, it } from 'vitest'
import { extractAuthTimeSec } from './session-lookup'

// D3 (04 11): authTime comes from the timestamp of the password entry in amr. Unknown -> null (never trusted by decideSession).
describe('extractAuthTimeSec (02 5.1.4 main plan)', () => {
  it('returns the timestamp of the password entry', () => {
    expect(extractAuthTimeSec({ amr: [{ method: 'password', timestamp: 1_760_000_000 }] })).toBe(1_760_000_000)
  })
  it('no amr claim -> null', () => {
    expect(extractAuthTimeSec({})).toBeNull()
  })
  it('empty amr -> null', () => {
    expect(extractAuthTimeSec({ amr: [] })).toBeNull()
  })
  it('string[] form (RFC 8176, no timestamps) -> null', () => {
    expect(extractAuthTimeSec({ amr: ['password'] })).toBeNull()
  })
  it('password entry without a timestamp -> null', () => {
    expect(extractAuthTimeSec({ amr: [{ method: 'password' }] })).toBeNull()
  })
  it('non-numeric, non-finite and non-positive timestamps are ignored', () => {
    for (const timestamp of ['1760000000', Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      expect(extractAuthTimeSec({ amr: [{ method: 'password', timestamp }] })).toBeNull()
    }
  })
  it('other methods are ignored (only password counts)', () => {
    expect(extractAuthTimeSec({ amr: [{ method: 'otp', timestamp: 1_760_000_500 }] })).toBeNull()
    expect(extractAuthTimeSec({ amr: [{ method: 'otp', timestamp: 1_760_000_500 }, { method: 'password', timestamp: 1_760_000_000 }] })).toBe(1_760_000_000)
  })
  it('several password entries -> the latest one', () => {
    expect(extractAuthTimeSec({ amr: [{ method: 'password', timestamp: 1_760_000_000 }, { method: 'password', timestamp: 1_760_100_000 }, { method: 'password', timestamp: 1_760_050_000 }] })).toBe(1_760_100_000)
  })
  it('null entries and non-object entries do not throw', () => {
    expect(extractAuthTimeSec({ amr: [null, 5, 'password', { method: 'password', timestamp: 1_760_000_000 }] })).toBe(1_760_000_000)
  })
})
