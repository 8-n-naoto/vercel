// View-restriction evaluation (07 1, 02 6.1). Pure functions: no I/O, no config, `now` is an argument.
// No `server-only`: it is pure and imports only types, but it lives under server/ and is used by services only.
import type { AccessPurpose, AccessVia, DenyReason, FileStatus, UserRole } from '@/lib/domain'

export type AccessStage = 'precheck' | 'issue' | 'deliver'

export interface AccessInput {
  now: Date
  stage: AccessStage
  via: AccessVia
  purpose: AccessPurpose
  folder: { deletedAt: Date | null }
  file: {
    status: FileStatus
    suspended: boolean
    viewStartsAt: Date | null
    viewEndsAt: Date | null
    expiresAt: Date | null
    downloadAllowed: boolean
  }
  viewer?: { disabledAt: Date | null; role: UserRole; isMember: boolean } | null
  link?: {
    revokedAt: Date | null
    expiresAt: Date
    maxViews: number | null
    viewCount: number
    hasPassword: boolean
    downloadAllowed: boolean
  } | null
  passwordVerified?: boolean
}

export type AccessDecision =
  | { allow: true; needsPassword: boolean; remainingViews: number | null }
  | { allow: false; reason: DenyReason }

const deny = (reason: DenyReason): AccessDecision => ({ allow: false, reason })
const allowPlain: AccessDecision = { allow: true, needsPassword: false, remainingViews: null }

export function evaluateAccess(i: AccessInput): AccessDecision {
  const { now, stage, via, purpose, file } = i
  const link = via === 'share_link' ? i.link : null

  // Stage 1: existence and membership
  if (i.folder.deletedAt !== null || file.status !== 'active') return deny('NOT_FOUND')
  if (via === 'share_link') {
    if (!link) return deny('NOT_FOUND')
    if (link.revokedAt !== null) return deny('LINK_REVOKED')
  } else {
    const viewer = i.viewer
    if (!viewer) return deny('NOT_MEMBER')
    if (viewer.disabledAt !== null) return deny('USER_DISABLED')
    if (via === 'admin_preview' && viewer.role !== 'admin') return deny('NOT_MEMBER')
    if (via === 'member' && !viewer.isMember) return deny('NOT_MEMBER')
  }

  // Stage 2: admin preview skips restrictions and download permission
  if (via === 'admin_preview') return allowPlain

  // Stage 3: file restrictions (half-open intervals)
  const t = now.getTime()
  if (file.suspended) return deny('SUSPENDED')
  if (file.expiresAt !== null && t >= file.expiresAt.getTime()) return deny('FILE_EXPIRED')
  if (file.viewStartsAt !== null && t < file.viewStartsAt.getTime()) return deny('NOT_STARTED')
  if (file.viewEndsAt !== null && t >= file.viewEndsAt.getTime()) return deny('ENDED')

  // Stage 4: link expiry
  if (link && t >= link.expiresAt.getTime()) return deny('LINK_EXPIRED')

  // Stage 5: download permission
  if (purpose === 'download') {
    if (!file.downloadAllowed) return deny('DOWNLOAD_NOT_ALLOWED')
    if (link && !link.downloadAllowed) return deny('DOWNLOAD_NOT_ALLOWED')
  }
  if (!link || stage === 'deliver') return allowPlain

  // Stage 6: password (precheck only reports whether one is needed)
  if (link.hasPassword && stage !== 'precheck') {
    if (i.passwordVerified === undefined) return deny('PASSWORD_REQUIRED')
    if (i.passwordVerified === false) return deny('PASSWORD_INVALID')
  }

  // Stage 7: view count (view only)
  if (purpose === 'view' && link.maxViews !== null && link.viewCount >= link.maxViews) return deny('VIEW_LIMIT_REACHED')

  return {
    allow: true,
    needsPassword: stage === 'precheck' && link.hasPassword,
    remainingViews: purpose === 'view' && link.maxViews !== null ? link.maxViews - link.viewCount : null,
  }
}

export interface IncrementFailureRow {
  revokedAt: Date | null
  expiresAt: Date
  maxViews: number | null
  viewCount: number
  dbNow: Date
}
export type IncrementFailureReason = 'NOT_FOUND' | 'LINK_REVOKED' | 'LINK_EXPIRED' | 'VIEW_LIMIT_REACHED'

// Reason for a 0-row atomic increment (07 2.2). `dbNow` is the DB clock (same as the UPDATE).
// The function stays pure: when the reason cannot be explained, `onUnexplained` lets the caller emit
// the structured log `share.increment_unexplained` (with linkId).
export function decideIncrementFailure(row: IncrementFailureRow | null, onUnexplained?: () => void): IncrementFailureReason {
  if (row === null) return 'NOT_FOUND'
  if (row.revokedAt !== null) return 'LINK_REVOKED'
  if (row.dbNow.getTime() >= row.expiresAt.getTime()) return 'LINK_EXPIRED'
  if (row.maxViews !== null && row.viewCount >= row.maxViews) return 'VIEW_LIMIT_REACHED'
  onUnexplained?.()
  return 'NOT_FOUND'
}
