// 06 4.3 / 4.4 / 5.1 / 5.2 / 5.3 / 9.13 / 9.14 against the dev database and Supabase Auth (service level).
// NOT RUN in WP-2.3: the dev DB was unreachable. Skipped without a database; run with npm run test:integration.
// D13 (04 11: transaction + Auth API latency of invites.accept) is not measured here either.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { findProfileById, profileEmailExists } from '@/server/repositories/profiles'
import { adminService } from '@/server/services/admin'
import { accept, completePasswordReset, invitesService } from '@/server/services/invites'
import { cleanupTestUsers, createTestUser, jar, type TestUser } from './helpers/auth-fixture'
import { cleanupInvitees, cleanupInvitesOf } from './helpers/invite-fixture'
import { purgeAuditOfTestUsers } from './helpers/phase2-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const inviteeEmails: string[] = []
const testUserIds: string[] = []
const makeUser = async (role: TestUser['role']): Promise<TestUser> => {
  const u = await createTestUser(role)
  testUserIds.push(u.id)
  return u
}

afterAll(async () => {
  if (dbUp) {
    await cleanupInvitees(inviteeEmails)
    await cleanupInvitesOf(testUserIds)
    await purgeAuditOfTestUsers() // audit_logs.actor_id is RESTRICT: remove the rows of the test users first
    await cleanupTestUsers()
  }
  await closeDb()
})
beforeEach(() => jar.cookies.clear())

const ctxOf = (u: TestUser | null, name: string): ServiceContext => ({
  actor: u ? { userId: u.id, email: u.email, displayName: 'IT', role: u.role } : null,
  requestMeta: { ip: '203.0.113.20', userAgent: 'vitest', requestId: 'it-invites' },
  now: new Date(),
  actionName: name,
})
const tokenOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1)
const newEmail = (): string => {
  const e = `it-invitee-${randomUUID()}@example.invalid`
  inviteeEmails.push(e)
  return e
}

describe.skipIf(!dbUp)('invites (06 4.3 / 5.1 / 5.2 / 9.13 / 9.14)', () => {
  it('createInvite -> inspect -> accept: profile, used_at; a second accept is NOT_FOUND; the old URL is revoked on re-issue', async () => {
    const adminUser = await makeUser('admin')
    const email = newEmail()
    const first = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    const second = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    await expect(invitesService.inspect(ctxOf(null, 'page:/invite'), tokenOf(first.inviteUrl), 'signup')).resolves.toEqual({ valid: false })
    const t = tokenOf(second.inviteUrl)
    await expect(invitesService.inspect(ctxOf(null, 'page:/invite'), t, 'signup')).resolves.toEqual({ valid: true, email })
    const password = `${randomUUID()}-Aa1`
    await expect(accept(ctxOf(null, 'invites.accept'), { token: t, displayName: 'Invitee', password })).resolves.toMatch(/^\/(folders|login)$/)
    await expect(getDb().transaction((tx) => profileEmailExists(tx, email))).resolves.toBe(true)
    const err = await accept(ctxOf(null, 'invites.accept'), { token: t, displayName: 'Invitee', password }).catch((e: unknown) => e)
    expect((err as AppError).shape.code).toBe('NOT_FOUND')
  })

  it('issuePasswordReset -> completePasswordReset: sessions are revoked, the URL cannot be used twice', async () => {
    const adminUser = await makeUser('admin')
    const target = await makeUser('user')
    const out = await adminService.issuePasswordReset(ctxOf(adminUser, 'admin.issuePasswordReset'), { userId: target.id })
    const t = tokenOf(out.resetUrl)
    await expect(invitesService.inspect(ctxOf(null, 'page:/reset'), t, 'password_reset')).resolves.toEqual({ valid: true, email: null })
    await completePasswordReset(ctxOf(null, 'passwordReset.complete'), { token: t, password: `${randomUUID()}-Bb2` })
    expect((await findProfileById(target.id))?.sessionRevokedAt).toBeInstanceOf(Date)
    const err = await completePasswordReset(ctxOf(null, 'passwordReset.complete'), { token: t, password: `${randomUUID()}-Cc3` }).catch((e: unknown) => e)
    expect((err as AppError).shape.code).toBe('NOT_FOUND')
  })
})
