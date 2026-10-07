import { describe, it, expect } from 'vitest'
import { decideSession } from './session'
import { SS_CASES, SS_X_CASES } from '@/tests/fixtures/authz'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('decideSession (07 13.2)', () => {
  itCoversSpec07('SS', SS_CASES.map((c) => c.id))
  it.each(SS_CASES)('$id', ({ input, expected }) => {
    expect(decideSession(input)).toBe(expected)
  })
})

describe('decideSession boundaries outside 07 (T-018)', () => {
  it.each(SS_X_CASES)('$id', ({ input, expected }) => {
    expect(decideSession(input)).toBe(expected)
  })
  // D-020: non-finite numeric input is rejected (fail-closed).
  const T_SEC = Date.UTC(2026, 9, 10, 10) / 1000
  const base = { sub: 'u', profile: { disabledAt: null, sessionRevokedAt: null }, authTimeSec: T_SEC, nowMs: T_SEC * 1000, maxAgeDays: 7 }
  it('SS-X07 decideSession: NaN authTimeSec is UNAUTHENTICATED', () => {
    expect(decideSession({ ...base, authTimeSec: Number.NaN })).toBe('UNAUTHENTICATED')
  })
  it('SS-X08 decideSession: Infinity / -Infinity authTimeSec is UNAUTHENTICATED', () => {
    expect(decideSession({ ...base, authTimeSec: Infinity })).toBe('UNAUTHENTICATED')
    expect(decideSession({ ...base, authTimeSec: -Infinity })).toBe('UNAUTHENTICATED')
  })
  it('SS-X09 decideSession: non-finite nowMs or maxAgeDays is UNAUTHENTICATED', () => {
    expect(decideSession({ ...base, nowMs: Number.NaN })).toBe('UNAUTHENTICATED')
    expect(decideSession({ ...base, maxAgeDays: Number.NaN })).toBe('UNAUTHENTICATED')
  })
  it('SS-X10 decideSession: the finite baseline is still ok', () => {
    expect(decideSession(base)).toBe('ok')
  })
})
