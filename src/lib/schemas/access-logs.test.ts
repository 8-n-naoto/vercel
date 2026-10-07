import { describe, expect, it } from 'vitest'
import { parseAccessLogFilter, parsePageNumber } from './access-logs'

const id = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'

describe('parseAccessLogFilter (06 9.7)', () => {
  it('keeps valid values', () => {
    const q = { fileId: id, result: 'denied', via: 'share_link', from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00+09:00' }
    expect(parseAccessLogFilter(q)).toEqual(q)
  })
  it('drops unknown result/via, non-uuid fileId and invalid ISO', () => {
    expect(parseAccessLogFilter({ fileId: 'x', result: 'ok', via: 'web', from: '2026-10-01', to: 'yesterday' })).toEqual({})
  })
  it('takes the first of repeated keys and ignores unknown keys', () => {
    expect(parseAccessLogFilter({ result: ['granted', 'denied'], other: 1 })).toEqual({ result: 'granted' })
  })
})

describe('parsePageNumber', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['0', 1],
    ['-3', 1],
    ['1.5', 1],
    ['abc', 1],
    ['2', 2],
    [['3', '4'], 3],
    [7, 7],
  ])('%j -> %d', (raw, expected) => {
    expect(parsePageNumber(raw)).toBe(expected)
  })
})
