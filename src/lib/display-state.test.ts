import { describe, expect, it } from 'vitest'
import { effectiveDownloadAllowed, fileDisplayState, inviteState, shareLinkState } from '@/lib/display-state'

const N = new Date('2026-10-10T00:00:00.000Z')
const at = (ms: number) => new Date(N.getTime() + ms)
const D = 86_400_000

const file = (o: Partial<{ suspended: boolean; viewStartsAt: Date | null; viewEndsAt: Date | null; expiresAt: Date | null }> = {}) => ({
  suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, ...o,
})
const link = (o: Partial<{ revokedAt: Date | null; expiresAt: Date; maxViews: number | null; viewCount: number }> = {}) => ({
  revokedAt: null, expiresAt: at(D), maxViews: null, viewCount: 0, ...o,
})

describe('display-state (07 11.4)', () => {
  it.each([
    ['DS-01', file(), 'public'],
    ['DS-02', file({ suspended: true, expiresAt: at(-D) }), 'suspended'],
    ['DS-03', file({ expiresAt: at(0) }), 'expired'],
    ['DS-04', file({ expiresAt: at(-D), viewStartsAt: at(D) }), 'expired'],
    ['DS-05', file({ viewStartsAt: at(1) }), 'not_started'],
    ['DS-06', file({ viewStartsAt: at(0) }), 'public'],
    ['DS-07', file({ viewEndsAt: at(0) }), 'ended'],
  ] as const)('%s fileDisplayState', (_id, input, expected) => {
    expect(fileDisplayState(input, N)).toBe(expected)
  })

  it.each([
    ['DS-08', link({ revokedAt: at(-1), expiresAt: at(-D) }), 'revoked'],
    ['DS-09', link({ expiresAt: at(0), maxViews: 1, viewCount: 1 }), 'expired'],
    ['DS-10', link({ expiresAt: at(D), maxViews: 1, viewCount: 1 }), 'limit_reached'],
    ['DS-11', link({ expiresAt: at(1), maxViews: null }), 'active'],
  ] as const)('%s shareLinkState', (_id, input, expected) => {
    expect(shareLinkState(input, N)).toBe(expected)
  })

  it.each([
    ['DS-14', { usedAt: at(-2), revokedAt: at(-1), expiresAt: at(D) }, 'used'],
    ['DS-15', { usedAt: null, revokedAt: at(-1), expiresAt: at(-D) }, 'revoked'],
    ['DS-16', { usedAt: null, revokedAt: null, expiresAt: at(0) }, 'expired'],
    ['DS-17', { usedAt: null, revokedAt: null, expiresAt: at(1) }, 'open'],
  ] as const)('%s inviteState', (_id, input, expected) => {
    expect(inviteState(input, N)).toBe(expected)
  })

  it('DS-18 effectiveDownloadAllowed', () => {
    expect(effectiveDownloadAllowed(false, true)).toBe(false)
    expect(effectiveDownloadAllowed(true, false)).toBe(false)
    expect(effectiveDownloadAllowed(true, true)).toBe(true)
  })

  // DS-12 (the 128-case grid against evaluateAccess) is added by WP-0.P2, which implements evaluateAccess.
  // The state grid itself is checked here so that the precedence order cannot drift: exactly one state per input.
  it('state precedence over the grid (suspended > expired > not_started > ended)', () => {
    const points = [null, at(-1), at(0), at(1)]
    for (const suspended of [false, true])
      for (const expiresAt of points)
        for (const viewStartsAt of points)
          for (const viewEndsAt of points) {
            const s = fileDisplayState({ suspended, expiresAt, viewStartsAt, viewEndsAt }, N)
            if (suspended) expect(s).toBe('suspended')
            else if (expiresAt && N >= expiresAt) expect(s).toBe('expired')
            else if (viewStartsAt && N < viewStartsAt) expect(s).toBe('not_started')
            else if (viewEndsAt && N >= viewEndsAt) expect(s).toBe('ended')
            else expect(s).toBe('public')
          }
  })
})
