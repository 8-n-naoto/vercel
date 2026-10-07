// Token generation, format check and hashing (07 3). Shared by invites, resets, share links and view tickets.
import { createHash, randomBytes } from 'node:crypto'
import { TOKEN_RE } from '@/lib/schemas/common'

const TOKEN_BYTES = 32

/** 32 bytes -> base64url without padding (43 chars). Throws on any other length; the message never includes the input. */
export function encodeToken(bytes: Uint8Array): string {
  if (bytes.length !== TOKEN_BYTES) throw new Error(`encodeToken expects ${TOKEN_BYTES} bytes`)
  return Buffer.from(bytes).toString('base64url')
}

export function generateToken(): string {
  return encodeToken(randomBytes(TOKEN_BYTES))
}

/** SHA-256 as lowercase hex (64 chars). Does not check the format. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isTokenFormat(s: unknown): s is string {
  return typeof s === 'string' && TOKEN_RE.test(s)
}

/** Last 4 characters, safe to store for display. */
export function tokenHint(token: string): string {
  return token.slice(-4)
}
