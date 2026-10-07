// Audit log writer (06 3.6). The metadata of every action is a closed type, so secrets cannot be passed in by mistake;
// a runtime guard repeats the check (allowed keys, forbidden key names, token-shaped values).
import 'server-only'
import type { AuditAction, AuditResult, AuditTargetType, FileCharset, UserRole } from '@/lib/domain'
import type { FileRestrictions } from '@/lib/dto'
import { isTokenFormat } from '@/server/security/tokens'
import type { ServiceContext } from '@/server/actions/define-action'
import { getDb } from '@/server/db/client'
import { insertAuditLog, type Db, type Tx } from '@/server/repositories/audit-logs'

type FolderText = { name: string; description: string }
type FileText = Partial<{ displayName: string; charset: FileCharset }>
type Empty = Record<never, never>

/** Allowed metadata per action (06 3.6). Do not add token / password / key values here. */
export interface AuditMetadata {
  'auth.login': Empty
  'auth.login_failed': { emailHash: string; reason: 'invalid_credentials' | 'disabled' | 'no_profile' }
  'auth.login_rate_limited': { rule: string }
  'auth.logout': Empty
  'invite.created': { email: string; role: UserRole; expiresAt: string }
  'invite.revoked': { email: string }
  'invite.accepted': { userId: string; role: UserRole }
  'account.profile_updated': { before: { displayName: string }; after: { displayName: string } }
  'account.password_changed': Empty
  'user.disabled': { email: string }
  'user.enabled': { email: string }
  'user.role_changed': { email: string; before: UserRole; after: UserRole }
  'user.password_reset_issued': { inviteId: string; expiresAt: string }
  'user.password_reset_completed': { inviteId: string }
  'folder.created': { name: string }
  'folder.updated': { before: FolderText; after: FolderText }
  'folder.deleted': { name: string; deletedFiles: number; revokedLinks: number }
  'member.added': { userId: string; displayName: string }
  'member.removed': { userId: string; displayName: string }
  'file.uploaded': { displayName: string; sizeBytes: number; charset: FileCharset }
  'file.updated': { before: FileText; after: FileText }
  'file.restrictions_updated': { before: Partial<FileRestrictions>; after: Partial<FileRestrictions> }
  'file.deleted': { displayName: string; revokedLinks: number }
  'file.upload_verification_failed': { reason: 'missing' | 'empty' | 'too_large' | 'not_html' | 'binary' | 'quota' }
  'share_link.created': {
    fileId: string
    label: string
    expiresAt: string
    maxViews: number | null
    hasPassword: boolean
    downloadAllowed: boolean
    tokenHint: string
  }
  'share_link.revoked': { fileId: string; tokenHint: string }
  'share_link.reissued': { fileId: string; oldLinkId: string; newLinkId: string; newTokenHint: string }
  'security.rate_limited': { rule: string }
  'system.cron_daily': { results: { step: string; processed: number; failed: number; ms: number }[]; durationMs: number }
  'system.egress_warning': { usedBytes: number; limitBytes: number }
  'system.storage_warning': { usedBytes: number; limitBytes: number }
}

/** Top-level keys allowed per action (runtime mirror of AuditMetadata; a missing action is a type error). */
export const AUDIT_METADATA_KEYS: { readonly [A in AuditAction]: readonly (keyof AuditMetadata[A] & string)[] } = {
  'auth.login': [],
  'auth.login_failed': ['emailHash', 'reason'],
  'auth.login_rate_limited': ['rule'],
  'auth.logout': [],
  'invite.created': ['email', 'role', 'expiresAt'],
  'invite.revoked': ['email'],
  'invite.accepted': ['userId', 'role'],
  'account.profile_updated': ['before', 'after'],
  'account.password_changed': [],
  'user.disabled': ['email'],
  'user.enabled': ['email'],
  'user.role_changed': ['email', 'before', 'after'],
  'user.password_reset_issued': ['inviteId', 'expiresAt'],
  'user.password_reset_completed': ['inviteId'],
  'folder.created': ['name'],
  'folder.updated': ['before', 'after'],
  'folder.deleted': ['name', 'deletedFiles', 'revokedLinks'],
  'member.added': ['userId', 'displayName'],
  'member.removed': ['userId', 'displayName'],
  'file.uploaded': ['displayName', 'sizeBytes', 'charset'],
  'file.updated': ['before', 'after'],
  'file.restrictions_updated': ['before', 'after'],
  'file.deleted': ['displayName', 'revokedLinks'],
  'file.upload_verification_failed': ['reason'],
  'share_link.created': ['fileId', 'label', 'expiresAt', 'maxViews', 'hasPassword', 'downloadAllowed', 'tokenHint'],
  'share_link.revoked': ['fileId', 'tokenHint'],
  'share_link.reissued': ['fileId', 'oldLinkId', 'newLinkId', 'newTokenHint'],
  'security.rate_limited': ['rule'],
  'system.cron_daily': ['results', 'durationMs'],
  'system.egress_warning': ['usedBytes', 'limitBytes'],
  'system.storage_warning': ['usedBytes', 'limitBytes'],
}

// Key names that may hold a secret. emailHash / tokenHint / newTokenHint / hasPassword are the documented safe ones.
const FORBIDDEN_KEY_RE = /token|password|passwd|secret|credential|cookie|ticket|apikey|api_key|service_role|salt|^key$/i
const SAFE_KEYS = new Set(['emailHash', 'tokenHint', 'newTokenHint', 'hasPassword'])

/** Throws (names only, never values) when the metadata could carry a secret. Exported for tests. */
export function assertSafeMetadata(action: AuditAction, metadata: object): void {
  const allowed: readonly string[] = AUDIT_METADATA_KEYS[action]
  for (const key of Object.keys(metadata)) {
    if (!allowed.includes(key)) throw new Error(`audit metadata key not allowed for ${action}: ${key}`)
  }
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6) throw new Error(`audit metadata too deep for ${action}`)
    if (typeof v === 'string') {
      if (isTokenFormat(v)) throw new Error(`audit metadata value looks like a token for ${action}`)
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
    } else if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (!SAFE_KEYS.has(k) && FORBIDDEN_KEY_RE.test(k)) throw new Error(`audit metadata key looks secret for ${action}: ${k}`)
        walk(child, depth + 1)
      }
    }
  }
  walk(metadata, 0)
}

export interface AuditEntry<A extends AuditAction> {
  action: A
  target?: { type: AuditTargetType; id: string }
  folderId?: string | null
  result?: AuditResult // default 'success'
  metadata: AuditMetadata[A]
  /** invites.accept records the new user as the actor (06 3.6). */
  actorOverride?: string
}

/** Writes one audit row. Call it inside the business transaction; failures (login failed, rate limited, ...) are written on their own. */
export async function record<A extends AuditAction>(executor: Tx | Db, ctx: ServiceContext, entry: AuditEntry<A>): Promise<void> {
  assertSafeMetadata(entry.action, entry.metadata)
  await insertAuditLog(executor, {
    actorId: entry.actorOverride ?? ctx.actor?.userId ?? null,
    action: entry.action,
    targetType: entry.target?.type ?? null,
    targetId: entry.target?.id ?? null,
    folderId: entry.folderId ?? null,
    result: entry.result ?? 'success',
    metadata: { ...entry.metadata },
    ip: ctx.requestMeta.ip,
    userAgent: ctx.requestMeta.userAgent,
  })
}

/** For failures written on their own (outside a business transaction): login failed, rate limited, verification failed. */
export async function recordStandalone<A extends AuditAction>(ctx: ServiceContext, entry: AuditEntry<A>): Promise<void> {
  await record(getDb(), ctx, entry)
}
