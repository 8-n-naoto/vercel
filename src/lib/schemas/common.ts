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
export const zNextPath = z
  .string()
  .max(2048)
  .refine((p) => p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\'), 'invalid_next')
export const zPage = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
})
