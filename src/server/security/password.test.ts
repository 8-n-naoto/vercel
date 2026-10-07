import { describe, it, expect, vi, afterEach } from 'vitest'
import { scryptSync } from 'node:crypto'
import { hashLinkPassword, verifyLinkPassword, parseScrypt, scryptKdf } from './password'

const PW01 = /^scrypt\$15\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/
const b64 = (n: number): string => Buffer.alloc(n, 1).toString('base64')
const SCRYPT_MAXMEM = 64 * 1024 * 1024

afterEach(() => vi.restoreAllMocks())

describe('hashLinkPassword / verifyLinkPassword (07 4)', () => {
  it('PW-01..04 format and verification', async () => {
    const h = await hashLinkPassword('correct horse')
    expect(h).toMatch(PW01) // PW-01
    expect(await verifyLinkPassword('correct horse', h)).toBe(true) // PW-02
    expect(await verifyLinkPassword('correct horsf', h)).toBe(false) // PW-03
    expect(await verifyLinkPassword('correct horse ', h)).toBe(false) // PW-04
  })
  it('PW-05 same plaintext gives different hashes, both verify', async () => {
    const [a, b] = await Promise.all([hashLinkPassword('same-pass-1'), hashLinkPassword('same-pass-1')])
    expect(a).not.toBe(b)
    expect(await verifyLinkPassword('same-pass-1', a)).toBe(true)
    expect(await verifyLinkPassword('same-pass-1', b)).toBe(true)
  })
  it('PW-06 half-width kana', async () => {
    const p = 'ﾊﾟｽﾜｰﾄﾞ1234'
    expect(await verifyLinkPassword(p, await hashLinkPassword(p))).toBe(true)
  })
  it('PW-07 NFC normalization', async () => {
    const h = await hashLinkPassword('が1234567')
    expect(await verifyLinkPassword('が1234567', h)).toBe(true)
  })
  it('PW-08 RFC 7914 known-answer vector through the KDF directly (logN 10, r 8, p 16, keylen 64, salt "NaCl")', async () => {
    const hashHex =
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640'
    const key = await scryptKdf('password', Buffer.from('NaCl'), 64, 10, 8, 16)
    expect(key.toString('hex')).toBe(hashHex)
    const wrong = await scryptKdf('passwore', Buffer.from('NaCl'), 64, 10, 8, 16)
    expect(wrong.toString('hex')).not.toBe(hashHex)
  })
  it('PW-08b a stored value with a 4-byte salt is rejected by the parser (verify is false, no throw)', async () => {
    const hash = await scryptKdf('password', Buffer.from('NaCl'), 64, 10, 8, 16)
    const stored = `scrypt$10$8$16$${Buffer.from('NaCl').toString('base64')}$${hash.toString('base64')}`
    expect(parseScrypt(stored)).toBeNull()
    expect(await verifyLinkPassword('password', stored)).toBe(false)
  })
  it('PW-08c salt boundary: 7 bytes rejected, 8 bytes accepted', async () => {
    expect(parseScrypt(`scrypt$10$8$1$${b64(7)}$${b64(32)}`)).toBeNull()
    expect(parseScrypt(`scrypt$10$8$1$${b64(8)}$${b64(32)}`)).not.toBeNull()
    const salt = Buffer.alloc(8, 3)
    const hash = await scryptKdf('pw-salt8', salt, 32, 10, 8, 1)
    const ok = `scrypt$10$8$1$${salt.toString('base64')}$${hash.toString('base64')}`
    expect(await verifyLinkPassword('pw-salt8', ok)).toBe(true)
  })
})

describe('parseScrypt', () => {
  it('PW-09 malformed values give null', () => {
    expect(parseScrypt('bcrypt$15$8$1$a$b')).toBeNull()
    expect(parseScrypt('scrypt$15$8$1$abc')).toBeNull()
    expect(parseScrypt(`scrypt$x$8$1$${b64(16)}$${b64(32)}`)).toBeNull()
  })
  it('PW-10 logN out of range gives null and verify is false', async () => {
    const s = `scrypt$25$8$1$${b64(16)}$${b64(32)}`
    expect(parseScrypt(s)).toBeNull()
    expect(await verifyLinkPassword('x', s)).toBe(false)
  })
  it('accepts a valid value and enforces the other bounds', () => {
    expect(parseScrypt(`scrypt$15$8$1$${b64(16)}$${b64(32)}`)).toMatchObject({ logN: 15, r: 8, p: 1 })
    expect(parseScrypt(`scrypt$9$8$1$${b64(16)}$${b64(32)}`)).toBeNull()
    expect(parseScrypt(`scrypt$15$33$1$${b64(16)}$${b64(32)}`)).toBeNull()
    expect(parseScrypt(`scrypt$15$8$17$${b64(16)}$${b64(32)}`)).toBeNull()
    expect(parseScrypt(`scrypt$15$8$1$${b64(7)}$${b64(32)}`)).toBeNull()
    expect(parseScrypt(`scrypt$15$8$1$${b64(16)}$${b64(15)}`)).toBeNull()
    expect(parseScrypt(`scrypt$15$8$1$${b64(16)}$${b64(65)}`)).toBeNull()
  })
  it('uses the stored parameters and keylen when verifying', async () => {
    const salt = Buffer.alloc(16, 7)
    const hash = scryptSync('pw-stored-1', salt, 16, { N: 1024, r: 8, p: 1, maxmem: SCRYPT_MAXMEM })
    const stored = `scrypt$10$8$1$${salt.toString('base64')}$${hash.toString('base64')}`
    expect(await verifyLinkPassword('pw-stored-1', stored)).toBe(true)
    expect(await verifyLinkPassword('pw-stored-2', stored)).toBe(false)
  })
  it('PW-11 empty stored value gives false without throwing', async () => {
    await expect(verifyLinkPassword('x', '')).resolves.toBe(false)
  })
})

describe('secrets never leak', () => {
  it('plain password and stored hash are not written to logs on malformed input', async () => {
    const plain = 'S3cret-plain-value!'
    const stored = `scrypt$25$8$1$${b64(16)}$${b64(32)}`
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ]
    await verifyLinkPassword(plain, stored)
    await verifyLinkPassword(plain, '')
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    expect(out).not.toContain(plain)
    expect(out).not.toContain(stored)
  })
  it('hash output does not contain the plaintext', async () => {
    const plain = 'S3cret-plain-value!'
    expect(await hashLinkPassword(plain)).not.toContain(plain)
  })
})
