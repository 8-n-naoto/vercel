import 'server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { folderMembers, profiles } from '@/server/db/schema'
import type { Db, Tx } from './audit-logs'
import type { Reader } from './reader'
import { notImplemented } from './not-implemented'

export type ProfileRow = typeof profiles.$inferSelect

/** One query (06 3.3). Only the columns that requireUser needs; the other columns of ProfileRow stay unread. */
export async function findProfileById(id: string) {
  const rows = await getDb()
    .select({
      id: profiles.id,
      email: profiles.email,
      displayName: profiles.displayName,
      role: profiles.role,
      disabledAt: profiles.disabledAt,
      sessionRevokedAt: profiles.sessionRevokedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1)
  return rows[0]
}

/** Sets last_login_at (06 4.1 step 3). Pass the transaction that also writes the auth.login audit row. */
export async function touchLastLogin(executor: Tx | Db, id: string, now: Date): Promise<void> {
  await executor.update(profiles).set({ lastLoginAt: now }).where(eq(profiles.id, id))
}

/** Locks the row (FOR UPDATE) and returns the ProfileView columns (06 4.5). Call inside the business transaction. */
export async function lockProfileForUpdate(tx: Tx, id: string) {
  const rows = await tx
    .select({ id: profiles.id, email: profiles.email, displayName: profiles.displayName, role: profiles.role, createdAt: profiles.createdAt })
    .from(profiles)
    .where(eq(profiles.id, id))
    .for('update')
    .limit(1)
  return rows[0]
}

/** Same columns without a lock (06 9.19). */
export async function findProfileView(id: string) {
  const rows = await getDb()
    .select({ id: profiles.id, email: profiles.email, displayName: profiles.displayName, role: profiles.role, createdAt: profiles.createdAt })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1)
  return rows[0]
}

export async function updateDisplayName(tx: Tx, id: string, displayName: string): Promise<void> {
  await tx.update(profiles).set({ displayName }).where(eq(profiles.id, id))
}

/** Invalidates every existing session of the user (06 4.6 step 3). */
export async function setSessionRevokedAt(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.update(profiles).set({ sessionRevokedAt: at }).where(eq(profiles.id, id))
}

export type SessionProfile = NonNullable<Awaited<ReturnType<typeof findProfileById>>>

export async function findProfileByEmail(email: string): Promise<ProfileRow | undefined> {
  return notImplemented('profiles.findProfileByEmail', [email])
}

export async function listProfiles(): Promise<ProfileRow[]> {
  return notImplemented('profiles.listProfiles', [])
}

/** Duplicate check by (lowercase) email, inside the business transaction (06 4.3 step 2, 5.1 step 1). */
export async function profileEmailExists(tx: Tx, email: string): Promise<boolean> {
  const rows = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, email)).limit(1)
  return rows.length > 0
}

export async function insertProfile(
  tx: Tx,
  v: { id: string; email: string; displayName: string; role: ProfileRow['role'] },
): Promise<void> {
  await tx.insert(profiles).values(v)
}

const stateCols = { id: profiles.id, email: profiles.email, disabledAt: profiles.disabledAt }

/** 06 4.4 step 2: FOR UPDATE. */
export async function lockProfileStateForUpdate(tx: Tx, id: string) {
  const rows = await tx.select(stateCols).from(profiles).where(eq(profiles.id, id)).for('update').limit(1)
  return rows[0]
}

/** 06 5.3: FOR SHARE. */
export async function lockProfileStateForShare(tx: Tx, id: string) {
  const rows = await tx.select(stateCols).from(profiles).where(eq(profiles.id, id)).for('share').limit(1)
  return rows[0]
}

/** 06 6.4 step 2: the targets of members.add, locked FOR SHARE in id order (a fixed order avoids deadlocks). */
export async function lockProfilesForShare(tx: Tx, ids: string[]) {
  return tx
    .select({ id: profiles.id, role: profiles.role, disabledAt: profiles.disabledAt, displayName: profiles.displayName })
    .from(profiles)
    .where(inArray(profiles.id, ids))
    .orderBy(asc(profiles.id))
    .for('share')
}

/** Display name for an audit row (06 6.5). */
export async function findDisplayName(tx: Tx, id: string): Promise<string | undefined> {
  const rows = await tx.select({ displayName: profiles.displayName }).from(profiles).where(eq(profiles.id, id)).limit(1)
  return rows[0]?.displayName
}

/** 06 9.6: one statement. Active users who are not yet members of the folder. */
export async function listMemberCandidates(db: Reader, folderId: string) {
  return db
    .select({ userId: profiles.id, displayName: profiles.displayName, email: profiles.email })
    .from(profiles)
    .where(
      and(
        eq(profiles.role, 'user'),
        isNull(profiles.disabledAt),
        sql`not exists (select 1 from ${folderMembers} where ${folderMembers.folderId} = ${folderId} and ${folderMembers.userId} = ${profiles.id})`,
      ),
    )
    .orderBy(asc(profiles.displayName), asc(profiles.id))
}
