// Common zod parts (06 1.3). Shared by client and server. The error map must be imported first so that it applies to every schema.
import './error-map'
import { z } from 'zod'
import { USER_ROLES, FILE_CHARSETS } from '@/lib/domain'

// Strings are trimmed before the length check (02 8.1)
export const zTrimmed = (min: number, max: number) => z.string().trim().min(min).max(max)
export const zUuid = z.uuid()
export const zEmail = z.string().trim().toLowerCase().max(254).email()
export const zDisplayName = zTrimmed(1, 50)
export const zLoginPassword = z.string().min(12).max(72) // surrounding whitespace is kept
export const zLinkPassword = z.string().min(8).max(128) // view password of a share link

/** Shared by zToken and isTokenFormat (07 3): 32 random bytes as base64url without padding. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const zToken = z.string().regex(TOKEN_RE) // invite / reset / share link / ticket

// e.g. '2026-10-10T09:00:00+09:00'. An offset is required. The server converts it to a Date and stores UTC (06 1.4).
export const zIsoDateTime = z.iso.datetime({ offset: true })
export const zNullableIsoDateTime = zIsoDateTime.nullable()
export const zUserRole = z.enum(USER_ROLES)
export const zCharset = z.enum(FILE_CHARSETS)
const NEXT_BASE = 'http://next-path.invalid'
// Raw control characters (U+0000-U+001F, U+007F) and backslash, plus the percent-encoded forms of control characters (%00-%1F, %7F) and backslash (%5C).
const NEXT_FORBIDDEN = /[\u0000-\u001f\u007f\\]|%(?:[01][0-9a-f]|7f|5c)/i

/**
 * A same-site absolute path usable as a post-login redirect target (02 appendix A T14, F-005).
 * Browsers strip tab / LF / CR from URLs, so "/<TAB>/evil.example" would become "//evil.example": control characters and backslashes are rejected
 * anywhere in the value, and the value must resolve to the same origin.
 */
export function isSafeNextPath(p: string): boolean {
  if (p.length > 2048 || !p.startsWith('/') || p.startsWith('//') || NEXT_FORBIDDEN.test(p)) return false
  try {
    return new URL(p, NEXT_BASE).origin === NEXT_BASE
  } catch {
    return false
  }
}

export const zNextPath = z.string().max(2048).refine(isSafeNextPath, 'invalid_next')
export const zPage = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
})
