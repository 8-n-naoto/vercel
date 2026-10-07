import { describe, it, expect } from 'vitest'
import { decideQuota } from './quota'
import { QT_CASES, QT_X_CASES } from '@/tests/fixtures/quota'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('decideQuota (07 6.3)', () => {
  itCoversSpec07('QT', QT_CASES.map((c) => c.id), { integrationFrom: 9 })
  it.each(QT_CASES)('$id', ({ userUsed, totalUsed, addBytes, userLimit, totalLimit, expected }) => {
    expect(decideQuota({ userUsed, totalUsed, addBytes, userLimit, totalLimit })).toBe(expected)
  })
})

describe('decideQuota boundaries outside 07 (T-018)', () => {
  it.each(QT_X_CASES)('$id', ({ userUsed, totalUsed, addBytes, userLimit, totalLimit, expected }) => {
    expect(decideQuota({ userUsed, totalUsed, addBytes, userLimit, totalLimit })).toBe(expected)
  })
  // Judgement requested in the T-018 report: NaN inputs currently fail open ('ok').
  it.todo('QT-X08 decideQuota: NaN addBytes / NaN limit should not return ok (fail closed)')
})
