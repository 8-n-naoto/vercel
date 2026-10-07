import { describe, expect, it } from 'vitest'
import { isoToJstInput, jstInputAfterDays, jstInputToIso } from '@/lib/datetime'

describe('datetime (08 6.3)', () => {
  it.each([
    ['FD-01', '2026-10-10T09:00', '2026-10-10T09:00:00+09:00'],
    ['FD-02', '', null],
    ['FD-03', null, null],
    ['FD-04', '2026-10-10T09:00:30', '2026-10-10T09:00:30+09:00'],
    ['FD-05', '2026/10/10 09:00', '2026/10/10 09:00'],
  ])('%s jstInputToIso', (_id, input, expected) => {
    expect(jstInputToIso(input)).toBe(expected)
  })

  it('jstInputToIso returns null for a File entry', () => {
    expect(jstInputToIso(new File([], 'x'))).toBeNull()
  })

  it.each([
    ['FD-06', '2026-10-10T00:00:00.000Z', '2026-10-10T09:00'],
    ['FD-07', '2026-12-31T15:30:00.000Z', '2027-01-01T00:30'],
    ['FD-08', null, ''],
  ])('%s isoToJstInput', (_id, input, expected) => {
    expect(isoToJstInput(input)).toBe(expected)
  })

  it('isoToJstInput returns an empty string for an unparsable value', () => {
    expect(isoToJstInput('not a date')).toBe('')
  })

  it('FD-09 jstInputAfterDays', () => {
    expect(jstInputAfterDays(new Date('2026-10-07T01:23:45.678Z'), 7)).toBe('2026-10-14T10:23')
  })

  it('FD-10 round trip keeps the instant', () => {
    const iso = '2026-10-10T00:00:00.000Z'
    const back = jstInputToIso(isoToJstInput(iso))
    expect(back).not.toBeNull()
    expect(Date.parse(back as string)).toBe(Date.parse(iso))
  })
})
