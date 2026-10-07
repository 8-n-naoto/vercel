// Display state derivation (07 11). Pure functions shared by client and server (do not import server-only). Not stored in the DB.
import type { FileDisplayState, InviteState, ShareLinkState } from '@/lib/domain'

/** Same order as evaluateAccess stage 3 (07 1.2). 'public' <=> a member's evaluateAccess allows. */
export function fileDisplayState(
  f: { suspended: boolean; viewStartsAt: Date | null; viewEndsAt: Date | null; expiresAt: Date | null },
  now: Date,
): FileDisplayState {
  const t = now.getTime()
  if (f.suspended) return 'suspended'
  if (f.expiresAt !== null && t >= f.expiresAt.getTime()) return 'expired'
  if (f.viewStartsAt !== null && t < f.viewStartsAt.getTime()) return 'not_started'
  if (f.viewEndsAt !== null && t >= f.viewEndsAt.getTime()) return 'ended'
  return 'public'
}

/** State of the link itself; the file side (suspension etc.) is not included. */
export function shareLinkState(
  l: { revokedAt: Date | null; expiresAt: Date; maxViews: number | null; viewCount: number },
  now: Date,
): ShareLinkState {
  if (l.revokedAt !== null) return 'revoked'
  if (now.getTime() >= l.expiresAt.getTime()) return 'expired'
  if (l.maxViews !== null && l.viewCount >= l.maxViews) return 'limit_reached'
  return 'active'
}

export function effectiveDownloadAllowed(fileDownloadAllowed: boolean, linkDownloadAllowed: boolean): boolean {
  return fileDownloadAllowed && linkDownloadAllowed
}

export function inviteState(i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InviteState {
  if (i.usedAt !== null) return 'used' // takes precedence over revoked
  if (i.revokedAt !== null) return 'revoked'
  if (now.getTime() >= i.expiresAt.getTime()) return 'expired'
  return 'open'
}
