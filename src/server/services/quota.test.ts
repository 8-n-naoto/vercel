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
  // D-020: non-finite inputs are rejected (fail-closed).
  const ok = { userUsed: 0, totalUsed: 0, addBytes: 10, userLimit: 1000, totalLimit: 1000 }
  it('QT-X08 decideQuota: NaN or Infinity in any field is not ok', () => {
    for (const k of Object.keys(ok) as (keyof typeof ok)[]) {
      expect(decideQuota({ ...ok, [k]: Number.NaN })).not.toBe('ok')
      expect(decideQuota({ ...ok, [k]: Infinity })).not.toBe('ok')
    }
  })
  it('QT-X09 decideQuota: NaN addBytes is rejected although addBytes <= 0 would be ok', () => {
    expect(decideQuota({ ...ok, addBytes: Number.NaN })).toBe('user')
    expect(decideQuota(ok)).toBe('ok')
  })
})
