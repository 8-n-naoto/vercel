// Test vectors for evaluateAccess / decideIncrementFailure. Copied one row per case from 07 1.3 and 2.3 (IDs preserved).
import type { AccessInput, AccessDecision, AccessStage } from '@/server/authz/access-policy'
import type { AccessPurpose, AccessVia, DenyReason } from '@/lib/domain'

// 07 uses N = 2026-10-10T00:00:00Z; this fixture uses a different N. Every vector is relative to N, so results are identical.
export const N = new Date('2026-10-08T03:00:00.000Z')
const DAY = 86_400_000
const MIN = 60_000
const SEC = 1000
const at = (offsetMs: number): Date => new Date(N.getTime() + offsetMs)

export type Via = 'M' | 'A' | 'S'
export type Stg = 'P' | 'I' | 'D'
export type Purp = 'V' | 'DL'

const VIA: Record<Via, AccessVia> = { M: 'member', A: 'admin_preview', S: 'share_link' }
const STAGE: Record<Stg, AccessStage> = { P: 'precheck', I: 'issue', D: 'deliver' }
const PURPOSE: Record<Purp, AccessPurpose> = { V: 'view', DL: 'download' }

export interface Overrides {
  folder?: Partial<AccessInput['folder']>
  file?: Partial<AccessInput['file']>
  viewer?: Partial<NonNullable<AccessInput['viewer']>> | null
  link?: Partial<NonNullable<AccessInput['link']>> | null
  passwordVerified?: boolean
}

const baseViewer = (role: 'user' | 'admin') => ({ disabledAt: null, role, isMember: true })
const baseLink = () => ({
  revokedAt: null, expiresAt: at(7 * DAY), maxViews: null, viewCount: 0, hasPassword: false, downloadAllowed: true,
})

// 07 1.3 base input (admin_preview vectors use viewer.role = 'admin').
export const baseInput = (via: Via, stage: Stg, purpose: Purp): AccessInput => ({
  now: N,
  stage: STAGE[stage],
  via: VIA[via],
  purpose: PURPOSE[purpose],
  folder: { deletedAt: null },
  file: { status: 'active', suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, downloadAllowed: true },
  ...(via === 'S' ? { link: baseLink() } : { viewer: baseViewer(via === 'A' ? 'admin' : 'user') }),
})

export const buildInput = (via: Via, stage: Stg, purpose: Purp, o: Overrides): AccessInput => {
  const b = baseInput(via, stage, purpose)
  const out: AccessInput = { ...b, folder: { ...b.folder, ...o.folder }, file: { ...b.file, ...o.file } }
  if (o.viewer === null) out.viewer = null
  else if (o.viewer !== undefined) out.viewer = { ...(b.viewer ?? baseViewer('user')), ...o.viewer }
  if (o.link === null) out.link = null
  else if (o.link !== undefined) out.link = { ...(b.link ?? baseLink()), ...o.link }
  if (o.passwordVerified !== undefined) out.passwordVerified = o.passwordVerified
  return out
}

const deny = (reason: DenyReason): AccessDecision => ({ allow: false, reason })
const allow = (needsPassword: boolean, remainingViews: number | null): AccessDecision => ({ allow: true, needsPassword, remainingViews })

export interface EaCase {
  id: string
  via: Via
  stage: Stg
  purpose: Purp
  over: Overrides
  expected: AccessDecision
}
const ea = (n: number, via: Via, stage: Stg, purpose: Purp, over: Overrides, expected: AccessDecision): EaCase => ({
  id: `EA-${String(n).padStart(2, '0')}`, via, stage, purpose, over, expected,
})
const ADMIN = { role: 'admin' as const, disabledAt: null }

export const EA_CASES: EaCase[] = [
  // 1.3.1 stage 1
  ea(1, 'M', 'I', 'V', { folder: { deletedAt: at(-DAY) } }, deny('NOT_FOUND')),
  ea(2, 'M', 'I', 'V', { file: { status: 'pending' } }, deny('NOT_FOUND')),
  ea(3, 'M', 'I', 'V', { file: { status: 'deleted' } }, deny('NOT_FOUND')),
  ea(4, 'S', 'P', 'V', { folder: { deletedAt: at(-DAY) } }, deny('NOT_FOUND')),
  ea(5, 'S', 'I', 'V', { link: null }, deny('NOT_FOUND')),
  ea(6, 'S', 'I', 'V', { link: { revokedAt: at(-MIN) } }, deny('LINK_REVOKED')),
  ea(7, 'S', 'I', 'V', { link: { revokedAt: at(-MIN) }, file: { suspended: true } }, deny('LINK_REVOKED')),
  ea(8, 'M', 'I', 'V', { viewer: null }, deny('NOT_MEMBER')),
  ea(9, 'M', 'I', 'V', { viewer: { disabledAt: at(-DAY) } }, deny('USER_DISABLED')),
  ea(10, 'M', 'I', 'V', { viewer: { disabledAt: at(-DAY), isMember: false } }, deny('USER_DISABLED')),
  ea(11, 'A', 'I', 'V', { viewer: { role: 'user' } }, deny('NOT_MEMBER')),
  ea(12, 'M', 'I', 'V', { viewer: { isMember: false } }, deny('NOT_MEMBER')),
  ea(13, 'M', 'I', 'V', { viewer: { isMember: false }, file: { suspended: true } }, deny('NOT_MEMBER')),
  ea(14, 'A', 'I', 'V', { viewer: { role: 'admin', disabledAt: at(-DAY), isMember: false } }, deny('USER_DISABLED')),
  ea(15, 'M', 'I', 'V', { viewer: { role: 'admin', isMember: false, disabledAt: null } }, deny('NOT_MEMBER')),
  ea(16, 'M', 'I', 'V', { folder: { deletedAt: at(-DAY) }, viewer: null }, deny('NOT_FOUND')),
  // 1.3.2 stage 2
  ea(17, 'A', 'I', 'V', { viewer: { ...ADMIN, isMember: false } }, allow(false, null)),
  ea(18, 'A', 'I', 'V', { viewer: ADMIN, file: { suspended: true, expiresAt: at(-DAY), viewStartsAt: at(DAY), viewEndsAt: at(2 * DAY) } }, allow(false, null)),
  ea(19, 'A', 'I', 'DL', { viewer: ADMIN, file: { downloadAllowed: false } }, allow(false, null)),
  ea(20, 'A', 'D', 'V', { viewer: ADMIN, file: { suspended: true } }, allow(false, null)),
  ea(21, 'A', 'I', 'V', { viewer: ADMIN, file: { status: 'pending' } }, deny('NOT_FOUND')),
  ea(22, 'A', 'D', 'DL', { viewer: ADMIN, folder: { deletedAt: at(-MIN) } }, deny('NOT_FOUND')),
  // 1.3.3 stage 3
  ea(23, 'M', 'I', 'V', {}, allow(false, null)),
  ea(24, 'M', 'I', 'V', { file: { suspended: true } }, deny('SUSPENDED')),
  ea(25, 'M', 'I', 'V', { file: { suspended: true, expiresAt: at(-DAY) } }, deny('SUSPENDED')),
  ea(26, 'M', 'I', 'V', { file: { expiresAt: at(0) } }, deny('FILE_EXPIRED')),
  ea(27, 'M', 'I', 'V', { file: { expiresAt: at(1) } }, allow(false, null)),
  ea(28, 'M', 'I', 'V', { file: { expiresAt: at(-1) } }, deny('FILE_EXPIRED')),
  ea(29, 'M', 'I', 'V', { file: { expiresAt: at(-DAY), viewStartsAt: at(DAY) } }, deny('FILE_EXPIRED')),
  ea(30, 'M', 'I', 'V', { file: { viewStartsAt: at(0) } }, allow(false, null)),
  ea(31, 'M', 'I', 'V', { file: { viewStartsAt: at(1) } }, deny('NOT_STARTED')),
  ea(32, 'M', 'I', 'V', { file: { viewStartsAt: at(DAY), viewEndsAt: at(2 * DAY) } }, deny('NOT_STARTED')),
  ea(33, 'M', 'I', 'V', { file: { viewEndsAt: at(0) } }, deny('ENDED')),
  ea(34, 'M', 'I', 'V', { file: { viewEndsAt: at(1) } }, allow(false, null)),
  ea(35, 'M', 'I', 'V', { file: { viewStartsAt: at(-2 * DAY), viewEndsAt: at(-DAY) } }, deny('ENDED')),
  ea(36, 'M', 'I', 'V', { file: { viewStartsAt: at(-DAY), viewEndsAt: at(DAY) } }, allow(false, null)),
  ea(37, 'M', 'I', 'V', { file: { viewStartsAt: at(DAY), viewEndsAt: at(-DAY) } }, deny('NOT_STARTED')),
  ea(38, 'M', 'D', 'V', { file: { suspended: true } }, deny('SUSPENDED')),
  ea(39, 'M', 'D', 'V', { file: { viewEndsAt: at(0) } }, deny('ENDED')),
  // 1.3.4 stage 4
  ea(40, 'S', 'I', 'V', { link: { expiresAt: at(0) } }, deny('LINK_EXPIRED')),
  ea(41, 'S', 'I', 'V', { link: { expiresAt: at(1) } }, allow(false, null)),
  ea(42, 'S', 'P', 'V', { link: { expiresAt: at(-DAY) } }, deny('LINK_EXPIRED')),
  ea(43, 'S', 'I', 'V', { file: { viewEndsAt: at(-DAY) }, link: { expiresAt: at(-DAY) } }, deny('ENDED')),
  ea(44, 'S', 'D', 'V', { link: { expiresAt: at(-1) } }, deny('LINK_EXPIRED')),
  ea(45, 'M', 'I', 'V', { link: { expiresAt: at(-DAY) } }, allow(false, null)),
  // 1.3.5 stage 5
  ea(46, 'M', 'I', 'DL', {}, allow(false, null)),
  ea(47, 'M', 'I', 'DL', { file: { downloadAllowed: false } }, deny('DOWNLOAD_NOT_ALLOWED')),
  ea(48, 'M', 'I', 'V', { file: { downloadAllowed: false } }, allow(false, null)),
  ea(49, 'M', 'I', 'DL', { file: { suspended: true, downloadAllowed: false } }, deny('SUSPENDED')),
  ea(50, 'S', 'I', 'DL', { link: { downloadAllowed: false } }, deny('DOWNLOAD_NOT_ALLOWED')),
  ea(51, 'S', 'I', 'DL', { file: { downloadAllowed: false }, link: { downloadAllowed: true } }, deny('DOWNLOAD_NOT_ALLOWED')),
  ea(52, 'S', 'I', 'DL', {}, allow(false, null)),
  ea(53, 'S', 'I', 'DL', { link: { expiresAt: at(-DAY), downloadAllowed: false } }, deny('LINK_EXPIRED')),
  ea(54, 'S', 'D', 'DL', { link: { downloadAllowed: false } }, deny('DOWNLOAD_NOT_ALLOWED')),
  ea(55, 'M', 'D', 'DL', { file: { downloadAllowed: false } }, deny('DOWNLOAD_NOT_ALLOWED')),
  // 1.3.6 stage 6, 7, deliver
  ea(56, 'S', 'I', 'V', { link: { hasPassword: true } }, deny('PASSWORD_REQUIRED')),
  ea(57, 'S', 'I', 'V', { link: { hasPassword: true }, passwordVerified: false }, deny('PASSWORD_INVALID')),
  ea(58, 'S', 'I', 'V', { link: { hasPassword: true }, passwordVerified: true }, allow(false, null)),
  ea(59, 'S', 'I', 'V', { link: { hasPassword: false }, passwordVerified: false }, allow(false, null)),
  ea(60, 'S', 'P', 'V', { link: { hasPassword: true } }, allow(true, null)),
  ea(61, 'S', 'I', 'DL', { link: { hasPassword: true } }, deny('PASSWORD_REQUIRED')),
  ea(62, 'S', 'I', 'DL', { link: { hasPassword: true }, passwordVerified: true }, allow(false, null)),
  ea(63, 'S', 'I', 'DL', { link: { maxViews: 1, viewCount: 1 } }, allow(false, null)),
  ea(64, 'S', 'I', 'V', { link: { maxViews: 1, viewCount: 0 } }, allow(false, 1)),
  ea(65, 'S', 'I', 'V', { link: { maxViews: 1, viewCount: 1 } }, deny('VIEW_LIMIT_REACHED')),
  ea(66, 'S', 'I', 'V', { link: { maxViews: 10000, viewCount: 9999 } }, allow(false, 1)),
  ea(67, 'S', 'I', 'V', { link: { maxViews: 3, viewCount: 5 } }, deny('VIEW_LIMIT_REACHED')),
  ea(68, 'S', 'I', 'V', { link: { maxViews: null, viewCount: 500 } }, allow(false, null)),
  ea(69, 'S', 'P', 'V', { link: { hasPassword: true, maxViews: 5, viewCount: 2 } }, allow(true, 3)),
  ea(70, 'S', 'P', 'V', { link: { hasPassword: true, maxViews: 2, viewCount: 2 } }, deny('VIEW_LIMIT_REACHED')),
  ea(71, 'S', 'I', 'V', { link: { hasPassword: true, maxViews: 2, viewCount: 2 }, passwordVerified: false }, deny('PASSWORD_INVALID')),
  ea(72, 'S', 'D', 'V', { link: { hasPassword: true, maxViews: 3, viewCount: 3 } }, allow(false, null)),
]

export interface IncrementRow {
  revokedAt: Date | null
  expiresAt: Date
  maxViews: number | null
  viewCount: number
  dbNow: Date
}
export interface InCase {
  id: string
  row: IncrementRow | null
  expected: 'NOT_FOUND' | 'LINK_REVOKED' | 'LINK_EXPIRED' | 'VIEW_LIMIT_REACHED'
  unexplained?: boolean
}
export const IN_CASES: InCase[] = [
  { id: 'IN-01', row: null, expected: 'NOT_FOUND' },
  { id: 'IN-02', row: { revokedAt: at(-SEC), expiresAt: at(-DAY), maxViews: 1, viewCount: 1, dbNow: N }, expected: 'LINK_REVOKED' },
  { id: 'IN-03', row: { revokedAt: null, expiresAt: N, maxViews: 1, viewCount: 1, dbNow: N }, expected: 'LINK_EXPIRED' },
  { id: 'IN-04', row: { revokedAt: null, expiresAt: at(DAY), maxViews: 3, viewCount: 3, dbNow: N }, expected: 'VIEW_LIMIT_REACHED' },
  { id: 'IN-05', row: { revokedAt: null, expiresAt: at(DAY), maxViews: null, viewCount: 9, dbNow: N }, expected: 'NOT_FOUND', unexplained: true },
]

// Additions outside 07 (T-018, F-003 proposal 5). X-marked IDs never collide with 07 IDs.
const eaX = (id: string, via: Via, stage: Stg, purpose: Purp, over: Overrides, expected: AccessDecision): EaCase => ({
  id, via, stage, purpose, over, expected,
})
export const EA_X_CASES: EaCase[] = [
  // via=member ignores a revoked link (revoked version of EA-45)
  eaX('EA-X01', 'M', 'I', 'V', { link: { revokedAt: at(-MIN) } }, allow(false, null)),
  // passwordVerified=false is PASSWORD_INVALID for both view and download
  eaX('EA-X02', 'S', 'I', 'DL', { link: { hasPassword: true }, passwordVerified: false }, deny('PASSWORD_INVALID')),
  // precheck + download + password: needsPassword is reported, remainingViews stays null for download
  eaX('EA-X03', 'S', 'P', 'DL', { link: { hasPassword: true, maxViews: 5, viewCount: 2 } }, allow(true, null)),
  // admin_preview: a disabled viewer is rejected before the role check, and a disabled admin is rejected as well
  eaX('EA-X04', 'A', 'I', 'V', { viewer: { role: 'user', disabledAt: at(-DAY) } }, deny('USER_DISABLED')),
  // maxViews = 0 can never be viewed (06 forbids it at creation; stored data is treated as exhausted)
  eaX('EA-X05', 'S', 'I', 'V', { link: { maxViews: 0, viewCount: 0 } }, deny('VIEW_LIMIT_REACHED')),
  eaX('EA-X06', 'S', 'I', 'DL', { link: { maxViews: 0, viewCount: 0 } }, allow(false, null)),
  // deliver with admin_preview and a deleted file
  eaX('EA-X07', 'A', 'D', 'V', { viewer: ADMIN, file: { status: 'deleted' } }, deny('NOT_FOUND')),
  // deliver does not re-check the password even when it was never verified
  eaX('EA-X08', 'S', 'D', 'DL', { link: { hasPassword: true } }, allow(false, null)),
]
