// Date normalization and validation of restrictions / share link expiry (07 12). Pure; `now` is always an argument.
// Shared by client and server: do not import server-only here.

/** Truncates sub-second precision (07 12.1). Comparison, storage and change detection all use the normalized value. */
export function toUtcSeconds(iso: string): Date {
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000)
}

export type RestrictionError = 'restrict.ends_before_starts' | 'restrict.expires_in_past'
export type LinkCreateError = 'link.expires_in_past' | 'link.expires_too_far' | 'link.download_not_allowed_by_file'

/**
 * Start / end may be in the past. expiresAt must be in the future only when it changes (so that an expired file can still be
 * suspended); changing to null (no expiry) is always allowed. Compared by instant, not by notation.
 */
export function validateRestrictions(
  next: { viewStartsAt: Date | null; viewEndsAt: Date | null; expiresAt: Date | null },
  current: { expiresAt: Date | null },
  now: Date,
): Partial<Record<'viewEndsAt' | 'expiresAt', RestrictionError>> {
  const errors: Partial<Record<'viewEndsAt' | 'expiresAt', RestrictionError>> = {}
  if (next.viewStartsAt && next.viewEndsAt && !(next.viewStartsAt.getTime() < next.viewEndsAt.getTime())) {
    errors.viewEndsAt = 'restrict.ends_before_starts'
  }
  if (next.expiresAt !== null && next.expiresAt.getTime() !== current.expiresAt?.getTime() && next.expiresAt.getTime() <= now.getTime()) {
    errors.expiresAt = 'restrict.expires_in_past'
  }
  return errors
}

/** Exactly maxDays days from now is allowed. */
export function validateLinkCreate(
  i: { expiresAt: Date; downloadAllowed: boolean },
  file: { downloadAllowed: boolean },
  now: Date,
  maxDays: number,
): Partial<Record<'expiresAt' | 'downloadAllowed', LinkCreateError>> {
  const errors: Partial<Record<'expiresAt' | 'downloadAllowed', LinkCreateError>> = {}
  if (i.expiresAt.getTime() <= now.getTime()) errors.expiresAt = 'link.expires_in_past'
  else if (i.expiresAt.getTime() > now.getTime() + maxDays * 86_400_000) errors.expiresAt = 'link.expires_too_far'
  if (i.downloadAllowed && !file.downloadAllowed) errors.downloadAllowed = 'link.download_not_allowed_by_file'
  return errors
}
