// 07 13.2 SS-01..SS-11 integration version + D3 (authentication time in amr). NOT RUN in WP-1.3: the dev DB was unreachable and
// no Supabase Auth user existed (HT #9). Skipped without a database; run with npm run test:integration.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { createSupabaseServerClient } from '@/server/auth/supabase-server'
import { extractAuthTimeSec } from '@/server/auth/session-lookup'
import { closeDb, pingDb } from '@/server/db/client'
import { requireAdmin, requireUser } from '@/server/authz/session'
import { cleanupTestUsers, createTestUser, deleteProfile, disableUser, jar, revokeSessions, signIn } from './helpers/auth-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

afterAll(async () => {
  if (dbUp) await cleanupTestUsers()
  await closeDb()
})
beforeEach(() => jar.cookies.clear())

describe.skipIf(!dbUp)('requireUser against the dev database and Supabase Auth (07 13.2)', () => {
  it('D3: the access token carries a password entry with a numeric timestamp close to the sign-in time', async () => {
    const u = await createTestUser('user')
    const before = Math.floor(Date.now() / 1000)
    await signIn(u)
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getClaims()
    expect(error).toBeNull()
    const t = extractAuthTimeSec(data?.claims ?? {})
    expect(t, 'amr has no password timestamp: switch to the HMAC cookie alternative (02 5.1.4); only extractAuthTimeSec changes').not.toBeNull()
    expect(Math.abs((t ?? 0) - before)).toBeLessThan(60)
  })

  it('valid session -> Actor with the profile role', async () => {
    const u = await createTestUser('user')
    await signIn(u)
    await expect(requireUser()).resolves.toMatchObject({ userId: u.id, email: u.email, role: 'user' })
  })

  it('SS-01 no cookie (sub null) -> UNAUTHENTICATED', async () => {
    await expect(requireUser()).rejects.toMatchObject({ shape: { code: 'UNAUTHENTICATED' } })
  })

  it('SS-02 valid Auth session but no profile row -> UNAUTHENTICATED', async () => {
    const u = await createTestUser('user')
    await signIn(u)
    await deleteProfile(u.id)
    await expect(requireUser()).rejects.toMatchObject({ shape: { code: 'UNAUTHENTICATED' } })
  })

  it('SS-03 disabled profile -> UNAUTHENTICATED', async () => {
    const u = await createTestUser('user')
    await signIn(u)
    await disableUser(u.id)
    await expect(requireUser()).rejects.toMatchObject({ shape: { code: 'UNAUTHENTICATED' } })
  })

  it('SS-05 session_revoked_at after the authentication time -> UNAUTHENTICATED', async () => {
    const u = await createTestUser('user')
    await signIn(u)
    await revokeSessions(u.id, new Date(Date.now() + 60_000))
    await expect(requireUser()).rejects.toMatchObject({ shape: { code: 'UNAUTHENTICATED' } })
  })

  it('SS-08 session_revoked_at before the authentication time -> ok', async () => {
    const u = await createTestUser('user')
    await revokeSessions(u.id, new Date(Date.now() - 3_600_000))
    await signIn(u)
    await expect(requireUser()).resolves.toMatchObject({ userId: u.id })
  })

  it('requireAdmin: admin ok, member FORBIDDEN', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    await signIn(admin)
    await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin' })
    await signIn(member)
    await expect(requireAdmin()).rejects.toMatchObject({ shape: { code: 'FORBIDDEN' } })
  })
})
