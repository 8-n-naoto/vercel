// Share-link view password hashing (07 4). scrypt via node:crypto; login passwords belong to Supabase Auth.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const LOG_N = 15
const R = 8
const P = 1
const KEYLEN = 32
const SALT_BYTES = 16
// Node default maxmem (32 MiB) equals 128 * N * r for N = 2^15 and fails with "memory limit exceeded".
const MAXMEM = 64 * 1024 * 1024

export interface ScryptParams {
  logN: number
  r: number
  p: number
  salt: Buffer
  hash: Buffer
}

const scryptAsync = (pw: Buffer, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(pw, salt, keylen, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)))
  })

const toBytes = (plain: string): Buffer => Buffer.from(plain.normalize('NFC'), 'utf8')
/** Raw KDF with explicit parameters (no stored-format parsing). Exported for the PW-08 known-answer test (D-019). */
export const scryptKdf = (plain: string, salt: Buffer, keylen: number, logN: number, r: number, p: number): Promise<Buffer> =>
  scryptAsync(toBytes(plain), salt, keylen, 2 ** logN, r, p)

const intIn = (s: string | undefined, min: number, max: number): number | null => {
  if (s === undefined || !/^\d{1,3}$/.test(s)) return null
  const n = Number(s)
  return n >= min && n <= max ? n : null
}
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/

export function parseScrypt(stored: string): ScryptParams | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const logN = intIn(parts[1], 10, 20)
  const r = intIn(parts[2], 1, 32)
  const p = intIn(parts[3], 1, 16)
  if (logN === null || r === null || p === null) return null
  const saltB64 = parts[4] ?? ''
  const hashB64 = parts[5] ?? ''
  if (!B64_RE.test(saltB64) || !B64_RE.test(hashB64)) return null
  const salt = Buffer.from(saltB64, 'base64')
  const hash = Buffer.from(hashB64, 'base64')
  // Salt lower bound is 8 bytes (07 4, D-019). PW-08 (RFC 7914, 4-byte salt) calls scryptKdf directly instead of going through this parser.
  if (salt.length < 8 || hash.length < 16 || hash.length > 64) return null
  return { logN, r, p, salt, hash }
}

export async function hashLinkPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await scryptAsync(toBytes(plain), salt, KEYLEN, 2 ** LOG_N, R, P)
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** Never throws. A malformed stored value is false (the caller logs password.hash_malformed with the link id only). */
export async function verifyLinkPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parsed = parseScrypt(stored)
    if (!parsed) return false
    const actual = await scryptAsync(toBytes(plain), parsed.salt, parsed.hash.length, 2 ** parsed.logN, parsed.r, parsed.p)
    return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash)
  } catch {
    return false
  }
}
