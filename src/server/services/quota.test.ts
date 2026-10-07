import { describe, it, expect } from 'vitest'
import { decideQuota } from './quota'
import { QT_CASES } from '@/tests/fixtures/quota'

describe('decideQuota (07 6.3)', () => {
  it.each(QT_CASES)('$id', ({ userUsed, totalUsed, addBytes, userLimit, totalLimit, expected }) => {
    expect(decideQuota({ userUsed, totalUsed, addBytes, userLimit, totalLimit })).toBe(expected)
  })
})
