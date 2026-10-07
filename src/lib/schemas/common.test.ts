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
  it('zNextPath rejects control characters, backslashes and off-origin results anywhere in the value (F-005)', () => {
    const bad = [
      '/\t/evil.example', // browsers strip tab / LF / CR from URLs, turning this into //evil.example
      '/\n/evil.example',
      '/\r/evil.example',
      '/\u0000x',
      '/a\u007fb',
      '/a\\b',
      '/\t\t/evil.example',
      '/%09/evil.example',
      '/%0a/evil.example',
      '/%0D/evil.example',
      '/%5c%5cevil',
      '/%5Cevil',
      '/%00',
      '/%7f',
    ]
    for (const p of bad) expect(zNextPath.safeParse(p).success, JSON.stringify(p)).toBe(false)
    for (const ok of ['/', '/folders/1?x=%20y', '/s/abc#top', '/a%2Fb']) expect(zNextPath.safeParse(ok).success, ok).toBe(true)
  })
  it('zPage defaults and bounds', () => {
    expect(zPage.parse({})).toEqual({ page: 1, pageSize: 50 })
    expect(zPage.safeParse({ page: 0 }).success).toBe(false)
    expect(zPage.safeParse({ pageSize: 101 }).success).toBe(false)
  })
})
