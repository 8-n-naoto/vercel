import 'server-only'
import { and, count, desc, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm'
import type { InviteState, InvitePurpose, UserRole } from '@/lib/domain'
import { getDb } from '@/server/db/client'
import { invites, profiles } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'

export type InviteRow = typeof invites.$inferSelect

/** Columns shared by the lock reads. */
const lockCols = {
  id: invites.id,
  purpose: invites.purpose,
  email: invites.email,
  role: invites.role,
  userId: invites.userId,
  expiresAt: invites.expiresAt,
  usedAt: invites.usedAt,
  revokedAt: invites.revokedAt,
}

/** 06 9.13: one statement. The profile is joined only to learn whether a reset target is disabled. */
export async function findInviteForInspect(tokenHash: string, purpose: InvitePurpose) {
  const rows = await getDb()
    .select({
      email: invites.email,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      revokedAt: invites.revokedAt,
      userDisabledAt: profiles.disabledAt,
    })
    .from(invites)
    .leftJoin(profiles, eq(profiles.id, invites.userId))
    .where(and(eq(invites.tokenHash, tokenHash), eq(invites.purpose, purpose)))
    .limit(1)
  return rows[0]
}

/** 06 4.3 step 1: FOR UPDATE on the signup invite. */
export async function lockSignupInviteByTokenHash(tx: Tx, tokenHash: string) {
  const rows = await tx
    .select(lockCols)
    .from(invites)
    .where(and(eq(invites.tokenHash, tokenHash), eq(invites.purpose, 'signup')))
    .for('update')
    .limit(1)
  return rows[0]
}

/** 06 4.4 step 1: no lock (the profile must be locked first, 06 1.6). */
export async function findResetInviteByTokenHash(tx: Tx, tokenHash: string) {
  const rows = await tx
    .select({ id: invites.id, userId: invites.userId })
    .from(invites)
    .where(and(eq(invites.tokenHash, tokenHash), eq(invites.purpose, 'password_reset')))
    .limit(1)
  return rows[0]
}

/** FOR UPDATE by id (06 4.4 step 3, 5.2). */
export async function lockInviteById(tx: Tx, id: string) {
  const rows = await tx.select(lockCols).from(invites).where(eq(invites.id, id)).for('update').limit(1)
  return rows[0]
}

export async function markInviteUsed(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(invites).set({ usedAt: at }).where(eq(invites.id, id))
}

export async function markInviteRevoked(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(invites).set({ revokedAt: at }).where(eq(invites.id, id))
}

/** 06 5.1 step 2: also covers expired unused rows. */
export async function revokeOpenSignupInvitesByEmail(tx: Tx, email: string, at: Date): Promise<void> {
  await tx
    .update(invites)
    .set({ revokedAt: at })
    .where(and(eq(invites.purpose, 'signup'), eq(invites.email, email), isNull(invites.usedAt), isNull(invites.revokedAt)))
}

/** 06 5.3. */
export async function revokeOpenResetInvitesByUser(tx: Tx, userId: string, at: Date): Promise<void> {
  await tx
    .update(invites)
    .set({ revokedAt: at })
    .where(and(eq(invites.purpose, 'password_reset'), eq(invites.userId, userId), isNull(invites.usedAt), isNull(invites.revokedAt)))
}

export interface InviteInsert {
  purpose: InvitePurpose
  email: string
  role: UserRole | null
  userId: string | null
  tokenHash: string
  expiresAt: Date
  createdBy: string
}

/** Stores only the hash of the token (the plaintext never reaches this layer). */
export async function insertInvite(tx: Tx, v: InviteInsert): Promise<string> {
  const rows = await tx.insert(invites).values(v).returning({ id: invites.id })
  const row = rows[0]
  if (!row) throw new Error('invite insert returned no row')
  return row.id
}

function stateCondition(state: InviteState, now: Date) {
  switch (state) {
    case 'open':
      return and(isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now))
    case 'used':
      return isNotNull(invites.usedAt)
    case 'revoked':
      return and(isNotNull(invites.revokedAt), isNull(invites.usedAt))
    case 'expired':
      return and(isNull(invites.usedAt), isNull(invites.revokedAt), lte(invites.expiresAt, now))
  }
}

/** 06 9.14: two statements (items, total). signup rows only. */
export async function listSignupInvites(filter: { state?: InviteState }, now: Date, page: { page: number; pageSize: number }) {
  const db: Db = getDb()
  const where = and(eq(invites.purpose, 'signup'), filter.state ? stateCondition(filter.state, now) : undefined)
  const items = await db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      revokedAt: invites.revokedAt,
      createdAt: invites.createdAt,
      createdById: invites.createdBy,
      createdByName: profiles.displayName,
    })
    .from(invites)
    .innerJoin(profiles, eq(profiles.id, invites.createdBy))
    .where(where)
    .orderBy(desc(invites.createdAt), desc(invites.id))
    .limit(page.pageSize)
    .offset((page.page - 1) * page.pageSize)
  const totals = await db.select({ total: count() }).from(invites).where(where)
  return { items, total: totals[0]?.total ?? 0 }
}
