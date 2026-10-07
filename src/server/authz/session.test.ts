import { describe, it, expect } from 'vitest'
import { decideSession } from './session'
import { SS_CASES } from '@/tests/fixtures/authz'

describe('decideSession (07 13.2)', () => {
  it.each(SS_CASES)('$id', ({ input, expected }) => {
    expect(decideSession(input)).toBe(expected)
  })
})
