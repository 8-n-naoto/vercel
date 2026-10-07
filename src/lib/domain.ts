// Enumerations shared by the DB CHECK constraints, Drizzle (text enum), zod and the UI (05 5, 02 4.12).
// Shared by client and server: do not import server-only here.
// Changing a value requires 05 5, the CHECK in 05 2 and a new migration in the same commit.

export const USER_ROLES = ['admin', 'user'] as const
export const INVITE_PURPOSES = ['signup', 'password_reset'] as const
export const FILE_STATUSES = ['pending', 'active', 'deleted'] as const
export const FILE_CONTENT_TYPES = ['text/html'] as const
export const FILE_CHARSETS = ['utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp'] as const
export const FILE_DELETE_REASONS = ['user', 'folder_deleted', 'expired', 'upload_abandoned', 'verification_failed'] as const
export const SHARE_LINK_REVOKE_REASONS = ['user', 'reissued', 'file_deleted', 'folder_deleted'] as const
export const ACCESS_VIAS = ['member', 'admin_preview', 'share_link'] as const
export const ACCESS_PURPOSES = ['view', 'download'] as const
export const ACCESS_RESULTS = ['granted', 'denied'] as const
export const DENY_REASONS = [
  'NOT_FOUND', 'LINK_REVOKED', 'NOT_MEMBER', 'USER_DISABLED', 'SUSPENDED', 'FILE_EXPIRED',
  'NOT_STARTED', 'ENDED', 'LINK_EXPIRED', 'DOWNLOAD_NOT_ALLOWED', 'PASSWORD_REQUIRED',
  'PASSWORD_INVALID', 'VIEW_LIMIT_REACHED',
] as const
// Deny reasons that surface as ACCESS_DENIED; the others become NOT_FOUND (07 1.4). src/lib/errors.ts (WP-0.3) re-exports the type.
export const PUBLIC_DENY_REASONS = [
  'SUSPENDED', 'FILE_EXPIRED', 'NOT_STARTED', 'ENDED', 'DOWNLOAD_NOT_ALLOWED', 'PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'VIEW_LIMIT_REACHED',
] as const satisfies readonly (typeof DENY_REASONS)[number][]
export const AUDIT_TARGET_TYPES =['user', 'invite', 'folder', 'member', 'file', 'share_link', 'system'] as const
export const AUDIT_RESULTS = ['success', 'failure'] as const
export const AUDIT_ACTIONS = [
  'auth.login', 'auth.login_failed', 'auth.login_rate_limited', 'auth.logout',
  'invite.created', 'invite.revoked', 'invite.accepted',
  'account.profile_updated', 'account.password_changed',
  'user.disabled', 'user.enabled', 'user.role_changed', 'user.password_reset_issued', 'user.password_reset_completed',
  'folder.created', 'folder.updated', 'folder.deleted',
  'member.added', 'member.removed',
  'file.uploaded', 'file.updated', 'file.restrictions_updated', 'file.deleted', 'file.upload_verification_failed',
  'share_link.created', 'share_link.revoked', 'share_link.reissued',
  'security.rate_limited',
  'system.cron_daily', 'system.egress_warning', 'system.storage_warning',
] as const // 31 kinds (02 5.10.2)

// Derived values that are not stored in the DB (06 2, 07 11)
export const FILE_DISPLAY_STATES = ['public', 'suspended', 'not_started', 'ended', 'expired'] as const
export const SHARE_LINK_STATES = ['active', 'expired', 'limit_reached', 'revoked'] as const
export const INVITE_STATES = ['open', 'used', 'revoked', 'expired'] as const

// Daily job steps (06 10.2, 04 3.10). Not stored in the DB; used for the dashboard labels (08 9.3).
export const CRON_STEPS = [
  'keepalive', 'pending_cleanup', 'expired_files', 'purge_retry', 'ticket_hash_null', 'retention', 'storage_reconcile', 'usage_warning',
] as const

export type UserRole = (typeof USER_ROLES)[number]
export type InvitePurpose = (typeof INVITE_PURPOSES)[number]
export type FileStatus = (typeof FILE_STATUSES)[number]
export type FileContentType = (typeof FILE_CONTENT_TYPES)[number]
export type FileCharset = (typeof FILE_CHARSETS)[number]
export type FileDeleteReason = (typeof FILE_DELETE_REASONS)[number]
export type ShareLinkRevokeReason = (typeof SHARE_LINK_REVOKE_REASONS)[number]
export type AccessVia = (typeof ACCESS_VIAS)[number]
export type AccessPurpose = (typeof ACCESS_PURPOSES)[number]
export type AccessResult = (typeof ACCESS_RESULTS)[number]
export type DenyReason = (typeof DENY_REASONS)[number]
export type PublicDenyReason = (typeof PUBLIC_DENY_REASONS)[number]
export type AuditTargetType =(typeof AUDIT_TARGET_TYPES)[number]
export type AuditResult = (typeof AUDIT_RESULTS)[number]
export type AuditAction = (typeof AUDIT_ACTIONS)[number]
export type FileDisplayState = (typeof FILE_DISPLAY_STATES)[number]
export type ShareLinkState = (typeof SHARE_LINK_STATES)[number]
export type InviteState = (typeof INVITE_STATES)[number]
export type CronStep = (typeof CRON_STEPS)[number]
