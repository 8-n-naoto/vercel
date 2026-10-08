// Extra fixtures for the Phase 2 (authentication / invitation) completion tests (T-032). Needs the dev database.
// Kept in its own file so that auth-fixture.ts / invite-fixture.ts stay untouched. No secret value is read or printed.
import { randomBytes } from 'node:crypto'
// Test fixture only: the rows under test are created by services, so no repository function exists for these reads / edits.
// eslint-disable-next-line no-restricted-imports
import { and, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/server/db/client'
import { auditLogs, invites } from '@/server/db/schema'
import { deleteRateLimitsByKeyPrefix } from '@/server/repositories/rate-limits'
import { rateLimitKey } from '@/server/security/rate-limit'
import { jar } from './auth-fixture'

/** A unique documentation-range IPv6 address. The /64 part varies because rate-limit keys round IPv6 to /64 (D-021), so counters never collide between runs or tests. */
export function uniqueIp(): string {
  const h = randomBytes(4).toString('hex')
  return `2001:db8:${h.slice(0, 4)}:${h.slice(4)}::1`
}

/** Makes getRequestMeta() (next/headers mock) see this client IP. */
export function useClientIp(ip: string): void {
  jar.headers.set('x-forwarded-for', ip)
}

/** Restores the default client IP of the jar. */
export function resetClientIp(): void {
  jar.headers.set('x-forwarded-for', '127.0.0.1')
}

/** Counts audit rows of any action since `since`, optionally filtered by actor / target id / ip. */
export async function countAuditSince(
  action: string,
  since: Date,
  filter: { actorId?: string; targetId?: string; ip?: string } = {},
): Promise<number> {
  const conds = [eq(auditLogs.action, action), gte(auditLogs.occurredAt, since)]
  if (filter.actorId) conds.push(eq(auditLogs.actorId, filter.actorId))
  if (filter.targetId) conds.push(eq(auditLogs.targetId, filter.targetId))
  if (filter.ip) conds.push(sql`${auditLogs.ip} = ${filter.ip}::inet`)
  return (await getDb().select({ id: auditLogs.id }).from(auditLogs).where(and(...conds))).length
}

/** Moves the expiry of an invite into the past (to test the expired path without waiting 72 hours). */
export async function expireInvite(inviteId: string): Promise<void> {
  await getDb()
    .update(invites)
    // invites_expires_ck requires expires_at > created_at, so created_at moves into the past as well.
    .set({ createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(invites.id, inviteId))
}

/** Removes the rate limit counters that a test created (keys are rebuilt with rateLimitKey; nothing else is touched). */
export async function deleteLoginCounters(ips: string[], emails: string[]): Promise<void> {
  for (const ip of ips) await deleteRateLimitsByKeyPrefix(rateLimitKey('login:ip', { ip }))
  for (const email of emails) await deleteRateLimitsByKeyPrefix(rateLimitKey('login:email', { email }))
}

/**
 * audit_logs.actor_id references profiles with ON DELETE RESTRICT, so a test user that acted (login, invite, password change)
 * cannot be removed by cleanupTestUsers() while its audit rows exist. Call this BEFORE cleanupTestUsers().
 * Only rows of throw-away users (it-<uuid>@example.invalid, it-invitee-... ) are deleted.
 */
export async function purgeAuditOfTestUsers(): Promise<void> {
  await getDb().execute(
    sql`DELETE FROM app.audit_logs WHERE actor_id IN (SELECT id FROM app.profiles WHERE email LIKE 'it-%@example.invalid')`,
  )
}
