// 06 4.5 / 4.6 / 9.19 against the dev database and Supabase Auth (service level: the Action only adds revalidatePath / redirect).
// NOT RUN in WP-2.5: the dev DB was unreachable. Skipped without a database; run with npm run test:integration.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, pingDb } from '@/server/db/client'
import { changePassword, getProfile, updateProfile } from '@/server/services/account'
import { signIn } from '@/server/services/auth'
import { cleanupTestUsers, createTestUser, jar, type TestUser } from './helpers/auth-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

afterAll(async () => {
  if (dbUp) await cleanupTestUsers()
  await closeDb()
})
beforeEach(() => jar.cookies.clear())

const ctxOf = (u: TestUser): ServiceContext => ({
  actor: { userId: u.id, email: u.email, displayName: 'IT User', role: 'user' },
  requestMeta: { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'it-account' },
  now: new Date(),
  actionName: 'account.updateProfile',
})

describe.skipIf(!dbUp)('account (06 4.5 / 4.6 / 9.19)', () => {
  it('updateProfile changes the display name; the same value is a no-op; getProfile reflects it', async () => {
    const u = await createTestUser('user')
    const a = await updateProfile(ctxOf(u), { displayName: 'Renamed' })
    expect(a.displayName).toBe('Renamed')
    await expect(updateProfile(ctxOf(u), { displayName: 'Renamed' })).resolves.toMatchObject({ displayName: 'Renamed' })
    await expect(getProfile(ctxOf(u))).resolves.toMatchObject({ id: u.id, displayName: 'Renamed' })
  })
  it('changePassword: wrong current password is VALIDATION_FAILED with fieldErrors; success lets the new password sign in', async () => {
    const u = await createTestUser('user')
    await signIn(ctxOf(u), { email: u.email, password: u.password, next: null })
    const err = await changePassword(ctxOf(u), { currentPassword: 'wrong-password-1', newPassword: 'brand-new-password-1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).shape.fieldErrors?.currentPassword).toBeDefined()
    await changePassword(ctxOf(u), { currentPassword: u.password, newPassword: 'brand-new-password-1' })
    await expect(signIn(ctxOf(u), { email: u.email, password: 'brand-new-password-1', next: null })).resolves.toBe('/folders')
  })
})
