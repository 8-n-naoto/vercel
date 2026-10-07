import { describe, expect, it } from 'vitest'
import { toUtcSeconds, validateLinkCreate, validateRestrictions } from '@/lib/schemas/restrictions'

const N = new Date('2026-10-10T00:00:00.000Z')
const at = (ms: number) => new Date(N.getTime() + ms)
const S = 1000
const D = 86_400_000
const NONE = { viewStartsAt: null, viewEndsAt: null, expiresAt: null }

describe('restrictions (07 12.4)', () => {
  it('DT-06 toUtcSeconds truncates sub-second precision', () => {
    expect(toUtcSeconds('2026-10-10T09:00:00.999+09:00').toISOString()).toBe('2026-10-10T00:00:00.000Z')
  })

  it.each([
    ['DT-07', { ...NONE, viewStartsAt: at(0), viewEndsAt: at(0) }, { expiresAt: null }, { viewEndsAt: 'restrict.ends_before_starts' }],
    ['DT-08', { ...NONE, viewStartsAt: at(0), viewEndsAt: at(S) }, { expiresAt: null }, {}],
    ['DT-09', { ...NONE, viewStartsAt: at(-10 * D), viewEndsAt: at(-D) }, { expiresAt: null }, {}],
    ['DT-10', { ...NONE, expiresAt: at(0) }, { expiresAt: null }, { expiresAt: 'restrict.expires_in_past' }],
    ['DT-11', { ...NONE, expiresAt: at(S) }, { expiresAt: null }, {}],
    ['DT-12', { ...NONE, expiresAt: at(-D) }, { expiresAt: at(-D) }, {}],
    // DT-13: the same instant written with a +09:00 offset (compared as an instant, not as notation)
    ['DT-13', { ...NONE, expiresAt: toUtcSeconds('2026-10-09T09:00:00+09:00') }, { expiresAt: at(-D) }, {}],
    ['DT-14', { ...NONE, expiresAt: null }, { expiresAt: at(-D) }, {}],
  ] as const)('%s validateRestrictions', (_id, next, current, expected) => {
    expect(validateRestrictions(next, current, N)).toEqual(expected)
  })

  const file = (downloadAllowed: boolean) => ({ downloadAllowed })
  it.each([
    ['DT-15', { expiresAt: at(0), downloadAllowed: false }, file(true), { expiresAt: 'link.expires_in_past' }],
    ['DT-16', { expiresAt: at(90 * D), downloadAllowed: false }, file(true), {}],
    ['DT-17', { expiresAt: at(90 * D + S), downloadAllowed: false }, file(true), { expiresAt: 'link.expires_too_far' }],
    ['DT-18', { expiresAt: at(D), downloadAllowed: true }, file(false), { downloadAllowed: 'link.download_not_allowed_by_file' }],
    ['DT-19', { expiresAt: at(D), downloadAllowed: false }, file(false), {}],
  ] as const)('%s validateLinkCreate', (_id, input, f, expected) => {
    expect(validateLinkCreate(input, f, N, 90)).toEqual(expected)
  })
})
