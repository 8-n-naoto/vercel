import { describe, expect, it } from 'vitest'
import { TOKEN_RE, zEmail, zIsoDateTime, zNextPath, zPage, zToken, zTrimmed } from '@/lib/schemas/common'

const A = (n: number) => 'A'.repeat(n)

describe('zIsoDateTime (07 12.4)', () => {
  it.each([
    ['DT-01', '2026-10-10T09:00:00+09:00', true],
    ['DT-02', '2026-10-10T00:00:00Z', true],
    ['DT-03', '2026-10-10', false],
    ['DT-04', '2026-10-10T09:00:00', false],
    ['DT-05', '', false],
  ])('%s', (_id, input, ok) => {
    expect(zIsoDateTime.safeParse(input).success).toBe(ok)
  })
})

describe('zToken (format check of 07 3: TK-07..TK-12)', () => {
  it.each([
    ['TK-07', A(43), true],
    ['TK-08', A(42), false],
    ['TK-09', A(44), false],
    ['TK-10', `${A(42)}+`, false],
    ['TK-11', `${A(42)}=`, false],
    ['TK-12a', `${A(42)} `, false],
    ['TK-12b', `${A(42)}Ａ`, false], // full-width letter, 43 characters
    ['TK-12c', null, false],
    ['TK-12d', 123, false],
    ['url-safe alphabet', `${A(41)}-_`, true],
  ])('%s', (_id, input, ok) => {
    expect(zToken.safeParse(input).success).toBe(ok)
    expect(typeof input === 'string' && TOKEN_RE.test(input)).toBe(ok)
  })
})

describe('other common parts', () => {
  it('zTrimmed trims before checking the length', () => {
    expect(zTrimmed(1, 5).safeParse('  ab  ').data).toBe('ab')
    expect(zTrimmed(1, 5).safeParse('   ').success).toBe(false)
  })
  it('zEmail trims and lowercases', () => {
    expect(zEmail.safeParse('  User@Example.COM ').data).toBe('user@example.com')
    expect(zEmail.safeParse('not-an-email').success).toBe(false)
  })
  it('zNextPath only accepts same-site absolute paths', () => {
    expect(zNextPath.safeParse('/folders').success).toBe(true)
    for (const bad of ['//evil.example', '/\\evil', 'https://evil.example', 'folders']) expect(zNextPath.safeParse(bad).success).toBe(false)
  })
  it('zPage defaults and bounds', () => {
    expect(zPage.parse({})).toEqual({ page: 1, pageSize: 50 })
    expect(zPage.safeParse({ page: 0 }).success).toBe(false)
    expect(zPage.safeParse({ pageSize: 101 }).success).toBe(false)
  })
})
