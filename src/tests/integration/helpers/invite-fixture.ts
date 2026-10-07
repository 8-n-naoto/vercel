// Cleanup for the invite / reset integration tests. Runs before cleanupTestUsers(): invites.created_by references profiles (RESTRICT).
import { createSupabaseAdminClient } from '@/server/auth/supabase-admin'
// Test fixture only: the rows are created by the services under test, so no repository function exists for deleting them.
// eslint-disable-next-line no-restricted-imports
import { eq, inArray, or } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { auditLogs, invites, profiles } from '@/server/db/schema'

/** Removes the invites for the given e-mails, and the users that accept() created for them (profile, audit rows, Auth user). */
export async function cleanupInvitees(emails: string[]): Promise<void> {
  if (emails.length === 0) return
  const db = getDb()
  const admin = createSupabaseAdminClient()
  const rows = await db.select({ id: profiles.id }).from(profiles).where(inArray(profiles.email, emails))
  const ids = rows.map((r) => r.id)
  await db.delete(invites).where(or(inArray(invites.email, emails), ids.length ? inArray(invites.userId, ids) : undefined))
  for (const id of ids) {
    await db.delete(auditLogs).where(eq(auditLogs.actorId, id))
    await db.delete(profiles).where(eq(profiles.id, id))
    await admin.auth.admin.deleteUser(id)
  }
}

/** Removes the invites created by (or issued for) the given test users so that cleanupTestUsers() can delete their profiles. */
export async function cleanupInvitesOf(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  await getDb().delete(invites).where(or(inArray(invites.createdBy, userIds), inArray(invites.userId, userIds)))
}
