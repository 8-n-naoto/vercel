import { describe, it, expect, vi } from 'vitest'
import { evaluateAccess, decideIncrementFailure } from './access-policy'
import { EA_CASES, EA_X_CASES, IN_CASES, buildInput } from '@/tests/fixtures/access'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('evaluateAccess (07 1.3)', () => {
  it('fixture has EA-01..EA-72 without gaps or duplicates', () => {
    expect(EA_CASES.map((c) => c.id)).toEqual(Array.from({ length: 72 }, (_, i) => `EA-${String(i + 1).padStart(2, '0')}`))
  })
  itCoversSpec07('EA', EA_CASES.map((c) => c.id))
  it.each(EA_CASES)('$id', ({ via, stage, purpose, over, expected }) => {
    expect(evaluateAccess(buildInput(via, stage, purpose, over))).toEqual(expected)
  })
})

describe('evaluateAccess boundaries outside 07 (T-018)', () => {
  it.each(EA_X_CASES)('$id', ({ via, stage, purpose, over, expected }) => {
    expect(evaluateAccess(buildInput(via, stage, purpose, over))).toEqual(expected)
  })
})

describe('decideIncrementFailure (07 2.3)', () => {
  itCoversSpec07('IN', IN_CASES.map((c) => c.id), { integrationFrom: 6 })
  it.each(IN_CASES)('$id', ({ row, expected, unexplained }) => {
    const spy = vi.fn()
    expect(decideIncrementFailure(row, spy)).toBe(expected)
    expect(spy).toHaveBeenCalledTimes(unexplained ? 1 : 0)
  })
})
