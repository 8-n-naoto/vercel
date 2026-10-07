// Test vectors for decideFolderAccess (07 13.1, FA-01..FA-11) and decideSession (07 13.2, SS-01..SS-11). IDs preserved.
import type { FolderAccessResult, FolderRow, FolderNeed } from '@/server/authz/folder'
import type { SessionInput } from '@/server/authz/session'
import type { UserRole } from '@/lib/domain'

const row = (folderDeleted: boolean, isMember: boolean): FolderRow => ({ folderDeleted, isMember })
const ok = (access: 'admin' | 'member'): FolderAccessResult => ({ ok: true, access })
const ng = (code: 'NOT_FOUND' | 'FORBIDDEN'): FolderAccessResult => ({ ok: false, code })

export const FA_CASES: { id: string; role: UserRole; row: FolderRow | null; need: FolderNeed; expected: FolderAccessResult }[] = [
  { id: 'FA-01', role: 'admin', row: null, need: 'view', expected: ng('NOT_FOUND') },
  { id: 'FA-02', role: 'admin', row: row(true, false), need: 'manage', expected: ng('NOT_FOUND') },
  { id: 'FA-03', role: 'admin', row: row(false, false), need: 'manage', expected: ok('admin') },
  { id: 'FA-04', role: 'admin', row: row(false, false), need: 'view', expected: ok('admin') },
  { id: 'FA-05', role: 'admin', row: row(false, true), need: 'view', expected: ok('admin') },
  { id: 'FA-06', role: 'user', row: null, need: 'view', expected: ng('NOT_FOUND') },
  { id: 'FA-07', role: 'user', row: row(true, true), need: 'view', expected: ng('NOT_FOUND') },
  { id: 'FA-08', role: 'user', row: row(false, false), need: 'view', expected: ng('NOT_FOUND') },
  { id: 'FA-09', role: 'user', row: row(false, false), need: 'manage', expected: ng('NOT_FOUND') },
  { id: 'FA-10', role: 'user', row: row(false, true), need: 'view', expected: ok('member') },
  { id: 'FA-11', role: 'user', row: row(false, true), need: 'manage', expected: ng('FORBIDDEN') },
]

// T = 2026-10-10T10:00:00Z. Base: valid and unrevoked profile, authTime T, now T, maxAgeDays 7.
export const T_MS = Date.parse('2026-10-10T10:00:00Z')
const T_SEC = T_MS / 1000
const DAY = 86_400_000
const base = (): SessionInput => ({
  sub: 'u1',
  profile: { disabledAt: null, sessionRevokedAt: null },
  authTimeSec: T_SEC,
  nowMs: T_MS,
  maxAgeDays: 7,
})
const withProfile = (p: Partial<NonNullable<SessionInput['profile']>>, o: Partial<SessionInput> = {}): SessionInput => {
  const b = base()
  return { ...b, ...o, profile: { ...(b.profile ?? { disabledAt: null, sessionRevokedAt: null }), ...p } }
}

export const SS_CASES: { id: string; input: SessionInput; expected: 'ok' | 'UNAUTHENTICATED' }[] = [
  { id: 'SS-01', input: { ...base(), sub: null }, expected: 'UNAUTHENTICATED' },
  { id: 'SS-02', input: { ...base(), profile: null }, expected: 'UNAUTHENTICATED' },
  { id: 'SS-03', input: withProfile({ disabledAt: new Date(T_MS - DAY) }), expected: 'UNAUTHENTICATED' },
  { id: 'SS-04', input: { ...base(), authTimeSec: null }, expected: 'UNAUTHENTICATED' },
  { id: 'SS-05', input: withProfile({ sessionRevokedAt: new Date(T_MS + 1) }, { nowMs: T_MS + 3_600_000 }), expected: 'UNAUTHENTICATED' },
  { id: 'SS-06', input: withProfile({ sessionRevokedAt: new Date(T_MS) }), expected: 'ok' },
  { id: 'SS-07', input: withProfile({ sessionRevokedAt: new Date(T_MS + 500) }), expected: 'UNAUTHENTICATED' },
  { id: 'SS-08', input: withProfile({ sessionRevokedAt: new Date(T_MS + 500) }, { authTimeSec: T_SEC + 1 }), expected: 'ok' },
  { id: 'SS-09', input: { ...base(), nowMs: T_MS + 7 * DAY }, expected: 'ok' },
  { id: 'SS-10', input: { ...base(), nowMs: T_MS + 7 * DAY + 1 }, expected: 'UNAUTHENTICATED' },
  { id: 'SS-11', input: { ...base(), nowMs: T_MS - 1000 }, expected: 'ok' },
]

// Additions outside 07 (T-018, F-003 proposal 3 and 4). X-marked IDs never collide with 07 IDs.
export const FA_X_CASES: typeof FA_CASES = [
  { id: 'FA-X01', role: 'admin', row: row(true, false), need: 'view', expected: ng('NOT_FOUND') },
  { id: 'FA-X02', role: 'admin', row: row(true, true), need: 'manage', expected: ng('NOT_FOUND') },
  { id: 'FA-X03', role: 'user', row: row(true, true), need: 'manage', expected: ng('NOT_FOUND') },
  { id: 'FA-X04', role: 'user', row: row(true, false), need: 'manage', expected: ng('NOT_FOUND') },
]

export const SS_X_CASES: typeof SS_CASES = [
  { id: 'SS-X01', input: { ...base(), authTimeSec: T_SEC + 0.5 }, expected: 'ok' }, // fractional auth_time
  { id: 'SS-X02', input: { ...base(), authTimeSec: -1 }, expected: 'UNAUTHENTICATED' }, // negative auth_time is far older than any max age
  { id: 'SS-X03', input: { ...base(), maxAgeDays: 0 }, expected: 'ok' }, // age 0 is not over a 0-day limit
  { id: 'SS-X04', input: { ...base(), maxAgeDays: 0, nowMs: T_MS + 1 }, expected: 'UNAUTHENTICATED' },
  { id: 'SS-X05', input: withProfile({ disabledAt: new Date(T_MS - DAY), sessionRevokedAt: new Date(T_MS - DAY) }), expected: 'UNAUTHENTICATED' },
  { id: 'SS-X06', input: withProfile({ disabledAt: new Date(T_MS - DAY), sessionRevokedAt: new Date(T_MS + 500) }), expected: 'UNAUTHENTICATED' },
]
