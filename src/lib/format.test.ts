import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime, formatMonthDayTime, formatPercent, formatRetryAfter } from '@/lib/format'

describe('format (08 6.4)', () => {
  it('formatDateTime', () => {
    expect(formatDateTime('2026-10-10T00:00:00.000Z')).toBe('2026/10/10 09:00')
    expect(formatDateTime('2026-12-31T15:30:00.000Z')).toBe('2027/01/01 00:30')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('garbage')).toBe('—')
  })

  it('formatMonthDayTime', () => {
    expect(formatMonthDayTime('2026-10-10T00:00:00.000Z')).toBe('10/10 09:00')
    expect(formatMonthDayTime(null)).toBe('—')
  })

  it.each([
    [0, '0B'],
    [1023, '1023B'],
    [1024, '1KB'],
    [1536, '1.5KB'],
    [1258291, '1.2MB'],
    [52428800, '50MB'],
    [966367641, '922MB'],
    [10 * 1024, '10KB'],
    [1048575, '1MB'], // rounds up into the next unit instead of "1024KB"
    [5 * 1024 ** 3, '5GB'],
  ])('formatBytes(%i) = %s', (n, expected) => {
    expect(formatBytes(n)).toBe(expected)
  })

  it('formatPercent floors', () => {
    expect(formatPercent(0.4699)).toBe('46%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('formatRetryAfter', () => {
    expect(formatRetryAfter(30)).toBe('（約 30 秒後に再試行できます）')
    expect(formatRetryAfter(59)).toBe('（約 59 秒後に再試行できます）')
    expect(formatRetryAfter(60)).toBe('（約 1 分後に再試行できます）')
    expect(formatRetryAfter(61)).toBe('（約 2 分後に再試行できます）')
  })
})
