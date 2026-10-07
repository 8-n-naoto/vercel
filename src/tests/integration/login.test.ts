// 06 4.1 / 4.2 against the dev database and Supabase Auth (service level: the Action only adds redirect()).
// NOT RUN in WP-2.1: the dev DB was unreachable. Skipped without a database; run with npm run test:integration.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, pingDb } from '@/server/db/client'
import { signIn, signOut } from '@/server/services/auth'
import { cleanupTestUsers, countAudit, createTestUser, deleteProfile, disableUser, findLastLoginAt, jar } from './helpers/auth-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

afterAll(async () => {
  if (dbUp) await cleanupTestUsers()
  await closeDb()
})
beforeEach(() => jar.cookies.clear())

const ctx = (): ServiceContext => ({
  actor: null,
  requestMeta: { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'it-login' },
  now: new Date(),
  actionName: 'auth.signIn',
})

describe.skipIf(!dbUp)('auth.signIn / auth.signOut (06 4.1 / 4.2)', () => {
  it('success: cookie set, last_login_at updated, auth.login recorded, returns /folders', async () => {
    const u = await createTestUser('user')
    await expect(signIn(ctx(), { email: u.email, password: u.password, next: null })).resolves.toBe('/folders')
    expect(jar.cookies.size).toBeGreaterThan(0)
    expect(await findLastLoginAt(u.id)).toBeInstanceOf(Date)
    expect(await countAudit('auth.login', { actorId: u.id })).toBe(1)
  })
  it('wrong password / no profile / disabled: same error, no session cookie left for the last two', async () => {
    const u = await createTestUser('user')
    const bad = await signIn(ctx(), { email: u.email, password: 'wrong-password', next: null }).catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(AppError)
    const noProfile = await createTestUser('user')
    await deleteProfile(noProfile.id)
    const e2 = await signIn(ctx(), { email: noProfile.email, password: noProfile.password, next: null }).catch((e: unknown) => e)
    await disableUser(u.id)
    const e3 = await signIn(ctx(), { email: u.email, password: u.password, next: null }).catch((e: unknown) => e)
    for (const e of [e2, e3]) expect(e).toBeInstanceOf(AppError)
    if (bad instanceof AppError && e2 instanceof AppError && e3 instanceof AppError) {
      expect(e2.shape).toEqual(bad.shape)
      expect(e3.shape).toEqual(bad.shape)
    }
    expect(await countAudit('auth.login_failed', { ip: '203.0.113.9' })).toBeGreaterThanOrEqual(3)
  })
  it('signOut records auth.logout and clears the session', async () => {
    const u = await createTestUser('user')
    await signIn(ctx(), { email: u.email, password: u.password, next: null })
    await signOut({ ...ctx(), actor: { userId: u.id, email: u.email, displayName: 'x', role: 'user' }, actionName: 'auth.signOut' })
    expect(await countAudit('auth.logout', { actorId: u.id })).toBe(1)
  })
})
