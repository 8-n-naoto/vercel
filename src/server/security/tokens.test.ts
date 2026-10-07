import { describe, it, expect } from 'vitest'
import { encodeToken, generateToken, hashToken, isTokenFormat, tokenHint } from './tokens'
import { ENCODE_CASES, FORMAT_CASES, rep } from '@/tests/fixtures/tokens'

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
})
