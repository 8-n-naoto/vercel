// Fixtures for the session / authorization integration tests (07 14). Needs the dev database AND dev Supabase Auth.
// Creates throw-away users (email "it-<uuid>@example.invalid", random password that is never printed) and removes them afterwards.
import { randomBytes, randomUUID } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'
// Test fixture only: it writes profile rows directly because no repository function exists for disabling / revoking yet (Phase 2).
// eslint-disable-next-line no-restricted-imports
import { and, eq } from 'drizzle-orm'
import type { UserRole } from '@/lib/domain'
import { createSupabaseAdminClient } from '@/server/auth/supabase-admin'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import { auditLogs, profiles } from '@/server/db/schema'

/** In-memory replacement of the Next request cookies / headers. vi.mock('next/headers', ...) points at nextHeadersMock. */
export const jar = {
  cookies: new Map<string, string>(),
  headers: new Headers({ 'x-forwarded-for': '127.0.0.1', 'user-agent': 'vitest-integration' }),
}

export const nextHeadersMock = {
  cookies: async () => ({
    getAll: () => [...jar.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value === '') jar.cookies.delete(name)
      else jar.cookies.set(name, value)
    },
  }),
  headers: async () => jar.headers,
}

export interface TestUser {
  id: string
  email: string
  password: string
  role: UserRole
}

const created: TestUser[] = []

export async function createTestUser(role: UserRole): Promise<TestUser> {
  const email = `it-${randomUUID()}@example.invalid`
  const password = randomBytes(18).toString('base64url') // >= 12 chars (Auth setting); never printed
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.name ?? 'no user'}`)
  const user: TestUser = { id: data.user.id, email, password, role }
  created.push(user)
  await getDb().insert(profiles).values({ id: user.id, email, displayName: `IT ${role}`, role })
  return user
}

/** Signs in with an @supabase/ssr client that writes into the jar (cookie attributes are not under test here). */
export async function signIn(user: TestUser): Promise<void> {
  const cfg = getConfig()
  jar.cookies.clear()
  const supabase = createServerClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.cookies].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) jar.cookies.set(c.name, c.value)
      },
    },
  })
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw new Error(`signIn failed: ${error.name} status=${String(error.status)} code=${String(error.code)}`)
}

/** Clears disabled_at / session_revoked_at so that one signed-in user can be reused across scenarios (saves Auth sign-in calls: rate limit). */
export async function resetUserState(id: string): Promise<void> {
  await getDb().update(profiles).set({ disabledAt: null, sessionRevokedAt: null }).where(eq(profiles.id, id))
}

export async function disableUser(id: string): Promise<void> {
  await getDb().update(profiles).set({ disabledAt: new Date() }).where(eq(profiles.id, id))
}
export async function revokeSessions(id: string, at: Date): Promise<void> {
  await getDb().update(profiles).set({ sessionRevokedAt: at }).where(eq(profiles.id, id))
}
export async function deleteProfile(id: string): Promise<void> {
  await getDb().delete(profiles).where(eq(profiles.id, id))
}

/** Removes every user created by createTestUser (profile row first: profiles.id references auth.users with ON DELETE RESTRICT). */
export async function cleanupTestUsers(): Promise<void> {
  const admin = createSupabaseAdminClient()
  for (const u of created.splice(0)) {
    await deleteProfile(u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
  jar.cookies.clear()
}

/** Read helpers for the login tests (no repository function reads these yet). */
export async function findLastLoginAt(id: string): Promise<Date | null | undefined> {
  const [row] = await getDb().select({ at: profiles.lastLoginAt }).from(profiles).where(eq(profiles.id, id))
  return row?.at
}
export async function countAudit(action: 'auth.login' | 'auth.login_failed' | 'auth.logout', filter: { actorId?: string; ip?: string }): Promise<number> {
  const conds = [eq(auditLogs.action, action)]
  if (filter.actorId) conds.push(eq(auditLogs.actorId, filter.actorId))
  if (filter.ip) conds.push(eq(auditLogs.ip, filter.ip))
  return (await getDb().select({ id: auditLogs.id }).from(auditLogs).where(and(...conds))).length
}
