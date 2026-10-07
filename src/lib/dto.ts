// Shared DTO types (06 2). Types only: shared by client and server. Never put a Date in a DTO (06 1.4).
import type {
  UserRole, FileCharset, AccessVia, AccessPurpose, AccessResult, DenyReason,
  FileDisplayState, ShareLinkState, InviteState, AuditResult, PublicDenyReason,
} from '@/lib/domain'

// ---------- users ----------
export interface ActorView { userId: string; email: string; displayName: string; role: UserRole }
export interface ProfileView { id: string; email: string; displayName: string; role: UserRole; createdAt: string }

// ---------- folders ----------
export interface FolderSummary { // S04
  id: string; name: string; description: string
  fileCount: number // admin: active count / member: displayState = 'public' count (07 11)
  updatedAt: string // the later of folders.updated_at and the max updated_at of active files in it
}
export interface FolderDetail { // S05 header / settings tab
  id: string; name: string; description: string
  createdAt: string; updatedAt: string
  access: 'admin' | 'member' // for UI branching only (not an authorization basis)
}

// ---------- members ----------
export interface MemberViewForAdmin { userId: string; displayName: string; email: string; addedAt: string; disabled: boolean }
export interface MemberViewForMember { userId: string; displayName: string }
export type MemberList =
  | { access: 'admin'; members: MemberViewForAdmin[] }
  | { access: 'member'; members: MemberViewForMember[] } // disabled users are not included
export interface MemberCandidate { userId: string; displayName: string; email: string }

// ---------- files ----------
export interface FileRestrictions {
  suspended: boolean; viewStartsAt: string | null; viewEndsAt: string | null
  expiresAt: string | null; downloadAllowed: boolean
}
export interface FileSummary { // S05 files tab (admin)
  id: string; folderId: string; displayName: string; sizeBytes: number
  displayState: FileDisplayState // 07 11
  viewStartsAt: string | null // for "before publication (10/10-)"
  activeShareLinkCount: number // number of links whose state = 'active'
  updatedAt: string
}
export interface MemberFileSummary { // S05 files tab (member; displayState = 'public' only)
  id: string; folderId: string; displayName: string; sizeBytes: number; updatedAt: string
}
export type FileList =
  | { access: 'admin'; files: FileSummary[] }
  | { access: 'member'; files: MemberFileSummary[] }
export interface FileDetail { // S07 (admin); return value of finalizeUpload / update / updateRestrictions
  id: string; folderId: string; folderName: string
  displayName: string; originalFilename: string; sizeBytes: number; charset: FileCharset
  displayState: FileDisplayState; restrictions: FileRestrictions
  uploadedBy: { id: string; displayName: string }
  activatedAt: string; updatedAt: string
}
export interface MemberFileDetail { // S07 (member, simple view)
  id: string; folderId: string; folderName: string
  displayName: string; sizeBytes: number; updatedAt: string; downloadAllowed: boolean
}
export type FileDetailResult =
  | { access: 'admin'; file: FileDetail }
  | { access: 'member'; file: MemberFileDetail }
export interface UploadContext { // S06
  folder: { id: string; name: string }
  maxFileSizeBytes: number
  userQuota: { usedBytes: number; limitBytes: number }
  totalQuota: { usedBytes: number; limitBytes: number }
}

// ---------- share links ----------
export interface ShareLinkView {
  id: string; fileId: string; label: string; tokenHint: string; expiresAt: string
  maxViews: number | null; viewCount: number; hasPassword: boolean
  downloadAllowed: boolean // value set on the link
  effectiveDownloadAllowed: boolean // file.downloadAllowed && link.downloadAllowed
  state: ShareLinkState // 07 11.2
  revokeReason: 'user' | 'reissued' | 'file_deleted' | 'folder_deleted' | null
  lastViewedAt: string | null; createdAt: string
}
export type SharePrecheck = // S09 display switch (shareLinks.precheck)
  | { kind: 'invalid' } // unknown / revoked / file or folder deleted -> 404
  | { kind: 'denied'; reason: PublicDenyReason; startsAt?: string }
  | {
      kind: 'ready'; fileName: string; linkExpiresAt: string
      needsPassword: boolean; remainingViews: number | null
      autoOpen: boolean // true when needsPassword = false and remainingViews = null
    }

// ---------- viewing ----------
export interface MemberViewContext { // initial S08 display (no ticket is issued)
  file: { id: string; displayName: string; folderId: string; folderName: string }
  mode: 'member' | 'admin_preview'
  previewNotice: FileDisplayState | null // the state when an admin previews a file whose displayState is not 'public'
}
export interface OpenAsMemberResult { viewUrl: string; canDownload: boolean; mode: 'member' | 'admin_preview' }
export interface OpenShareLinkResult {
  viewUrl: string; downloadUrl: string | null; downloadExpiresAt: string | null
  fileName: string; remainingViews: number | null; linkExpiresAt: string
}

// ---------- logs ----------
export interface AccessLogRow { // S05 access log tab (admin only)
  id: number; occurredAt: string
  file: { id: string; displayName: string }
  via: AccessVia; purpose: AccessPurpose; result: AccessResult; denyReason: DenyReason | null
  viewer:
    | { kind: 'user'; userId: string; displayName: string }
    | { kind: 'share_link'; linkId: string; label: string; tokenHint: string }
  delivered: boolean; ip: string | null; userAgent: string | null
}
/** 06 9.7. Built from the URL query (src/lib/schemas/access-logs.ts); invalid values are dropped. from/to are ISO strings: from <= occurred_at < to. */
export interface AccessLogFilter { fileId?: string; result?: AccessResult; via?: AccessVia; from?: string; to?: string }
export interface AuditLogRow { // S13
  id: number; occurredAt: string
  actor: { id: string; displayName: string } | null
  action: string; targetType: string | null; targetId: string | null
  targetLabel: string | null // display name of the target (only when available; 06 9.17)
  folderId: string | null; result: AuditResult
  metadata: Record<string, unknown>; ip: string | null; userAgent: string | null
}

// ---------- administration ----------
export interface InviteRow { // S10 (purpose = 'signup' only)
  id: string; email: string; role: UserRole; state: InviteState
  expiresAt: string; usedAt: string | null; revokedAt: string | null
  createdBy: { id: string; displayName: string }; createdAt: string
}
export interface UserRow { // S11
  id: string; email: string; displayName: string; role: UserRole
  disabled: boolean; lastLoginAt: string | null; createdAt: string
  folderCount: number | null // null for admins (the UI shows "all folders")
  isSelf: boolean
}
export interface AdminFolderRow { // S12
  id: string; name: string; memberCount: number; fileCount: number
  usedBytes: number // sum of size_bytes of active + pending files
  activeShareLinkCount: number
  createdBy: { id: string; displayName: string }; updatedAt: string
}
export interface Dashboard { // S13 upper part
  storage: { usedBytes: number; limitBytes: number; ratio: number; warn: boolean } // warn = ratio >= 0.8
  egress: { usedBytes: number; limitBytes: number; ratio: number; warn: boolean }
  last24h: { loginFailures: number; accessDenied: number; loginFailureAlert: boolean } // alert = loginFailures >= 20
  cron: {
    lastRunAt: string | null; stale: boolean // stale = never ran or older than 48 hours
    results: { step: string; processed: number; failed: number; ms: number }[] | null
  }
}
export type InviteInspect = { valid: false } | { valid: true; email: string | null } // email is null for a reset

// ---------- paging (06 1.5) ----------
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
