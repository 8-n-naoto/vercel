import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { profiles } from '@/server/db/schema'
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

export type SessionProfile = NonNullable<Awaited<ReturnType<typeof findProfileById>>>

export async function findProfileByEmail(email: string): Promise<ProfileRow | undefined> {
  return notImplemented('profiles.findProfileByEmail', [email])
}

export async function listProfiles(): Promise<ProfileRow[]> {
  return notImplemented('profiles.listProfiles', [])
}
