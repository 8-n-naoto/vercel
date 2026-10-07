import { describe, it, expect } from 'vitest'
import { decideAdminChange } from './last-admin'
import { LA_CASES } from '@/tests/fixtures/last-admin'

describe('decideAdminChange (07 7)', () => {
  it.each(LA_CASES)('$id', ({ input, expected }) => {
    expect(decideAdminChange(input)).toBe(expected)
  })
})
