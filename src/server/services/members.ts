// Member procedures (06 6.4 / 6.5) and RSC reads (06 9.5 / 9.6). The data access is injectable (MemberDeps).
import 'server-only'
import type { MemberCandidate, MemberList } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { message } from '@/lib/messages'
import { zUuid } from '@/lib/schemas/common'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFolderRole, type FolderLock, type FolderNeed } from '@/server/authz/folder'
import { getDb } from '@/server/db/client'
import { deleteFolderMember, insertFolderMembers, listMemberRows } from '@/server/repositories/folder-members'
import { findDisplayName, listMemberCandidates, lockProfilesForShare } from '@/server/repositories/profiles'
import { record } from './audit'

export interface MemberTx {
  /** assertFolderRole(manage) with the given lock. */
  assertManage: (folderId: string, lock: FolderLock) => Promise<{ id: string }>
  lockProfiles: (ids: string[]) => Promise<{ id: string; role: 'admin' | 'user'; disabledAt: Date | null; displayName: string }[]>
  insertMembers: (folderId: string, userIds: string[]) => Promise<string[]>
  deleteMember: (folderId: string, userId: string) => Promise<boolean>
  displayNameOf: (userId: string) => Promise<string | undefined>
  auditAdded: (folderId: string, userId: string, displayName: string) => Promise<void>
  auditRemoved: (folderId: string, userId: string, displayName: string) => Promise<void>
}

export type MemberRow = Awaited<ReturnType<typeof listMemberRows>>[number]

export interface MemberDeps {
  transaction: <T>(ctx: ServiceContext, fn: (tx: MemberTx) => Promise<T>) => Promise<T>
  /** assertFolderRole without a lock (a read-only transaction: assertFolderRole takes Tx only, see 10 record) (06 9.5 / 9.6). */
  assertFolder: (ctx: ServiceContext, folderId: string, need: FolderNeed) => Promise<{ access: 'admin' | 'member' }>
  listRows: (folderId: string, includeDisabled: boolean) => Promise<MemberRow[]>
  listCandidateRows: (folderId: string) => Promise<MemberCandidate[]>
}

const auditTarget = (folderId: string, userId: string) => ({ type: 'member' as const, id: `${folderId}:${userId}` })

export const defaultMemberDeps: MemberDeps = {
  transaction: (ctx, fn) =>
    getDb().transaction((tx) => {
      const actorId = ctx.actor?.userId
      if (!actorId) throw appError('UNAUTHENTICATED', 'common.unauthenticated')
      return fn({
        assertManage: async (folderId, lock) => (await assertFolderRole(ctx, tx, folderId, 'manage', { lock })).folder,
        lockProfiles: (ids) => lockProfilesForShare(tx, ids),
        insertMembers: (folderId, userIds) => insertFolderMembers(tx, folderId, userIds, actorId),
        deleteMember: (folderId, userId) => deleteFolderMember(tx, folderId, userId),
        displayNameOf: (userId) => findDisplayName(tx, userId),
        auditAdded: (folderId, userId, displayName) =>
          record(tx, ctx, { action: 'member.added', target: auditTarget(folderId, userId), folderId, metadata: { userId, displayName } }),
        auditRemoved: (folderId, userId, displayName) =>
          record(tx, ctx, { action: 'member.removed', target: auditTarget(folderId, userId), folderId, metadata: { userId, displayName } }),
      })
    }),
  assertFolder: (ctx, folderId, need) => getDb().transaction((tx) => assertFolderRole(ctx, tx, folderId, need)),
  listRows: (folderId, includeDisabled) => listMemberRows(getDb(), folderId, includeDisabled),
  listCandidateRows: (folderId) => listMemberCandidates(getDb(), folderId),
}

/** 06 6.4. One invalid target rejects the whole request (fieldErrors.userIds). Already-members are counted in `skipped`. */
async function add(
  ctx: ServiceContext,
  input: { folderId: string; userIds: string[] },
  deps: MemberDeps = defaultMemberDeps,
): Promise<{ added: number; skipped: number }> {
  return deps.transaction(ctx, async (tx) => {
    const folder = await tx.assertManage(input.folderId, 'share')
    const profiles = await tx.lockProfiles(input.userIds)
    const invalid = profiles.length !== input.userIds.length || profiles.some((p) => p.role !== 'user' || p.disabledAt !== null)
    if (invalid) {
      throw appError('VALIDATION_FAILED', 'common.validation_failed', { fieldErrors: { userIds: [message('member.invalid_target')] } })
    }
    const inserted = await tx.insertMembers(folder.id, input.userIds)
    const names = new Map(profiles.map((p) => [p.id, p.displayName]))
    for (const userId of inserted) {
      await tx.auditAdded(folder.id, userId, names.get(userId) ?? '')
    }
    return { added: inserted.length, skipped: input.userIds.length - inserted.length }
  })
}

/** 06 6.5. NOT_FOUND when the user is not a member (a second call is NOT_FOUND). */
async function remove(ctx: ServiceContext, input: { folderId: string; userId: string }, deps: MemberDeps = defaultMemberDeps): Promise<void> {
  await deps.transaction(ctx, async (tx) => {
    const folder = await tx.assertManage(input.folderId, 'share')
    const displayName = await tx.displayNameOf(input.userId)
    const removed = await tx.deleteMember(folder.id, input.userId)
    if (!removed) throw appError('NOT_FOUND', 'common.not_found')
    await tx.auditRemoved(folder.id, input.userId, displayName ?? '')
  })
}

/** 06 9.5. Members get userId and displayName only (no e-mail, no disabled users). */
async function list(ctx: ServiceContext, folderId: string, deps: MemberDeps = defaultMemberDeps): Promise<MemberList> {
  if (!zUuid.safeParse(folderId).success) throw appError('NOT_FOUND', 'common.not_found')
  const { access } = await deps.assertFolder(ctx, folderId, 'view')
  const rows = await deps.listRows(folderId, access === 'admin')
  if (access === 'admin') {
    return {
      access: 'admin',
      members: rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        email: r.email,
        addedAt: r.addedAt.toISOString(),
        disabled: r.disabledAt !== null,
      })),
    }
  }
  return { access: 'member', members: rows.map((r) => ({ userId: r.userId, displayName: r.displayName })) }
}

/** 06 9.6 (manage only: a member gets FORBIDDEN, a non-member NOT_FOUND). */
async function listCandidates(ctx: ServiceContext, folderId: string, deps: MemberDeps = defaultMemberDeps): Promise<MemberCandidate[]> {
  if (!zUuid.safeParse(folderId).success) throw appError('NOT_FOUND', 'common.not_found')
  await deps.assertFolder(ctx, folderId, 'manage')
  return deps.listCandidateRows(folderId)
}

export const membersService = { list, listCandidates, add, remove }
