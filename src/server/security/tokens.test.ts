import { describe, it, expect } from 'vitest'
import { encodeToken, generateToken, hashToken, isTokenFormat, tokenHint } from './tokens'
import { ENCODE_CASES, FORMAT_CASES, FORMAT_X_CASES, HASH_X_CASES, rep } from '@/tests/fixtures/tokens'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('07 3 coverage', () => {
  // TK-03..06 and TK-13 are individual tests below; listed here so that removing one is noticed together with the fixture rows.
  itCoversSpec07('TK', [...ENCODE_CASES.map((c) => c.id), ...FORMAT_CASES.map((c) => c.id), 'TK-03', 'TK-04', 'TK-05', 'TK-06', 'TK-13'])
})

describe('encodeToken (07 3)', () => {
  it.each(ENCODE_CASES)('$id', ({ bytes, expected }) => {
    expect(encodeToken(Uint8Array.from(bytes))).toBe(expected)
  })
  it('TK-03 throws on 31 bytes', () => {
    expect(() => encodeToken(new Uint8Array(31))).toThrow()
  })
})

describe('generateToken', () => {
  it('TK-04 1000 tokens are all well-formed and unique', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const t = generateToken()
      expect(isTokenFormat(t)).toBe(true)
      set.add(t)
    }
    expect(set.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('TK-05 known SHA-256 value (lowercase hex)', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('TK-06 deterministic, 64 lowercase hex chars', () => {
    const a = hashToken(rep('A', 43))
    expect(a).toBe(hashToken(rep('A', 43)))
    expect(a).toHaveLength(64)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isTokenFormat', () => {
  it.each(FORMAT_CASES)('$id', ({ input, expected }) => {
    expect(isTokenFormat(input)).toBe(expected)
  })
  it.each(FORMAT_X_CASES)('$id (outside 07)', ({ input, expected }) => {
    expect(isTokenFormat(input)).toBe(expected)
  })
})

describe('hashToken boundaries (outside 07)', () => {
  it.each(HASH_X_CASES)('$id', ({ input, expected }) => {
    expect(hashToken(input)).toBe(expected)
  })
  it('TK-X08 does not throw on a lone surrogate', () => {
    expect(hashToken('\ud800')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('tokenHint', () => {
  it('TK-13 last 4 characters', () => {
    expect(tokenHint(rep('A', 39) + 'wxyz')).toBe('wxyz')
  })
})

describe('secrets never leak', () => {
  it('encodeToken error message does not contain the input bytes', () => {
    const secret = new Uint8Array(31).fill(0xab)
    let msg = ''
    try {
      encodeToken(secret)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).not.toBe('')
    expect(msg).not.toContain(Buffer.from(secret).toString('base64'))
    expect(msg).not.toContain(Buffer.from(secret).toString('hex'))
    expect(msg).not.toContain('171')
  })
  it('TK-X09 encodeToken error message does not contain a 33-byte input either', () => {
    const secret = new Uint8Array(33).fill(0xcd)
    let msg = ''
    try {
      encodeToken(secret)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).not.toBe('')
    expect(msg).not.toContain(Buffer.from(secret).toString('base64url'))
    expect(msg).not.toContain(Buffer.from(secret).toString('hex'))
  })
  it('TK-X10 hashToken output never contains the token or its prefix', () => {
    const token = generateToken()
    const h = hashToken(token)
    expect(h).not.toContain(token)
    expect(h).not.toContain(token.slice(0, 8))
    expect(h).toHaveLength(64)
  })
  it('TK-X11 tokenHint returns exactly the last 4 characters and nothing else of the token', () => {
    const token = generateToken()
    const hint = tokenHint(token)
    expect(hint).toHaveLength(4)
    expect(hint).toBe(token.slice(-4))
    expect(hint).not.toBe(token)
    expect(tokenHint(rep('B', 39) + 'wxyz')).not.toContain('B')
  })
  it('TK-X12 hashToken and tokenHint do not throw on empty input', () => {
    expect(() => hashToken('')).not.toThrow()
    expect(tokenHint('')).toBe('')
  })
})
