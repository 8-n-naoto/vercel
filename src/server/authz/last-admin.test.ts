import { describe, it, expect } from 'vitest'
import { decideAdminChange } from './last-admin'
import { LA_CASES, LA_X_CASES } from '@/tests/fixtures/last-admin'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('decideAdminChange (07 7)', () => {
  itCoversSpec07('LA', LA_CASES.map((c) => c.id), { integrationFrom: 11 })
  it.each(LA_CASES)('$id', ({ input, expected }) => {
    expect(decideAdminChange(input)).toBe(expected)
  })
})

describe('decideAdminChange boundaries outside 07 (T-018)', () => {
  it.each(LA_X_CASES)('$id', ({ input, expected }) => {
    expect(decideAdminChange(input)).toBe(expected)
  })
  // Judgement requested in the T-018 report: the empty list with an enabled admin target currently returns ok.
  it.todo('LA-X05 decideAdminChange: empty activeAdminIds with an enabled admin target (inconsistent data) should not be ok')
})
