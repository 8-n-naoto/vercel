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
  // Judgement requested in the T-018 report: NaN / Infinity authTimeSec currently pass (comparisons with NaN are false).
  it.todo('SS-X07 decideSession: NaN authTimeSec should be UNAUTHENTICATED')
  it.todo('SS-X08 decideSession: Infinity authTimeSec should be UNAUTHENTICATED')
})
