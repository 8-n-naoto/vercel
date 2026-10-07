// 02 10 phase 1 completion conditions (2)(4)(6)(7) and appendix A T1 / T4 / T12 against the dev database and Supabase Auth.
// Fills the gaps that login / account / invites / session / rate-limit tests do not cover (see docs/agents/test-plan.md, table "Phase 1").
// NOT RUN in WP-2.7: the dev DB was unreachable (HT #11). Skipped without a database; run with npm run test:integration.
import { randomUUID } from 'node:crypto'
// Test only: a raw read of the audit rows written by the services under test (no repository function exists for it).
// eslint-disable-next-line no-restricted-imports
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { authSignIn, invitesAccept } from '@/app/_actions/auth'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { requireUser } from '@/server/authz/session'
import { getConfig } from '@/server/config'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { profileEmailExists } from '@/server/repositories/profiles'
import { adminService } from '@/server/services/admin'
import { accept, completePasswordReset, invitesService } from '@/server/services/invites'
import { cleanupTestUsers, createTestUser, jar, signIn, type TestUser } from './helpers/auth-fixture'
import { cleanupInvitees, cleanupInvitesOf } from './helpers/invite-fixture'
import { countAuditSince, deleteLoginCounters, expireInvite, purgeAuditOfTestUsers, resetClientIp, uniqueIp, useClientIp } from './helpers/phase2-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const inviteeEmails: string[] = []
const testUserIds: string[] = []
const usedIps: string[] = []
const usedEmails: string[] = []
const startedAt = new Date(Date.now() - 60_000) // audit rows of this run (a minute of slack for clock differences)

const makeUser = async (role: TestUser['role']): Promise<TestUser> => {
  const u = await createTestUser(role)
  testUserIds.push(u.id)
  return u
}
const newEmail = (): string => {
  const e = `it-invitee-${randomUUID()}@example.invalid`
  inviteeEmails.push(e)
  return e
}
const tokenOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1)
const strongPassword = (): string => `${randomUUID()}-Aa1`
const ctxOf = (u: TestUser | null, name: string): ServiceContext => ({
  actor: u ? { userId: u.id, email: u.email, displayName: 'IT', role: u.role } : null,
  requestMeta: { ip: '203.0.113.30', userAgent: 'vitest', requestId: 'it-phase1' },
  now: new Date(),
  actionName: name,
})
const codeOf = (e: unknown): string | undefined => (e instanceof AppError ? e.shape.code : undefined)

afterAll(async () => {
  if (dbUp) {
    await deleteLoginCounters(usedIps, usedEmails)
    await cleanupInvitees(inviteeEmails)
    await cleanupInvitesOf(testUserIds)
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})
beforeEach(() => {
  jar.cookies.clear()
  resetClientIp()
})

describe.skipIf(!dbUp)('phase 1 (2): revoked / expired invitations cannot register', () => {
  it('P1-2a revoked invite: inspect is { valid: false }, accept is NOT_FOUND, no profile is created', async () => {
    const adminUser = await makeUser('admin')
    const email = newEmail()
    const issued = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    await adminService.revokeInvite(ctxOf(adminUser, 'admin.revokeInvite'), { inviteId: issued.inviteId })
    const t = tokenOf(issued.inviteUrl)
    await expect(invitesService.inspect(ctxOf(null, 'page:/invite'), t, 'signup')).resolves.toEqual({ valid: false })
    const err = await accept(ctxOf(null, 'invites.accept'), { token: t, displayName: 'Nobody', password: strongPassword() }).catch((e: unknown) => e)
    expect(codeOf(err)).toBe('NOT_FOUND')
    await expect(getDb().transaction((tx) => profileEmailExists(tx, email))).resolves.toBe(false)
  })

  it('P1-2b expired invite: inspect is { valid: false }, accept is NOT_FOUND, no profile is created', async () => {
    const adminUser = await makeUser('admin')
    const email = newEmail()
    const issued = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    await expireInvite(issued.inviteId)
    const t = tokenOf(issued.inviteUrl)
    await expect(invitesService.inspect(ctxOf(null, 'page:/invite'), t, 'signup')).resolves.toEqual({ valid: false })
    const err = await accept(ctxOf(null, 'invites.accept'), { token: t, displayName: 'Nobody', password: strongPassword() }).catch((e: unknown) => e)
    expect(codeOf(err)).toBe('NOT_FOUND')
    await expect(getDb().transaction((tx) => profileEmailExists(tx, email))).resolves.toBe(false)
  })

  it('P1-2c a superseded password reset URL cannot be used (S03-2)', async () => {
    const adminUser = await makeUser('admin')
    const target = await makeUser('user')
    const first = await adminService.issuePasswordReset(ctxOf(adminUser, 'admin.issuePasswordReset'), { userId: target.id })
    await adminService.issuePasswordReset(ctxOf(adminUser, 'admin.issuePasswordReset'), { userId: target.id }) // revokes the first URL
    await expect(invitesService.inspect(ctxOf(null, 'page:/reset'), tokenOf(first.resetUrl), 'password_reset')).resolves.toEqual({ valid: false })
    const err = await completePasswordReset(ctxOf(null, 'passwordReset.complete'), { token: tokenOf(first.resetUrl), password: strongPassword() }).catch((e: unknown) => e)
    expect(codeOf(err)).toBe('NOT_FOUND')
  })
})

describe.skipIf(!dbUp)('phase 1 (4): the sixth failed sign-in for one e-mail is RATE_LIMITED (06 3.5 login:email, 5 per 15 minutes)', () => {
  it('P1-4 / S01-4 five failures are VALIDATION_FAILED, the sixth is RATE_LIMITED with retryAfterSec; auth.login_rate_limited is audited once', async () => {
    const ip = uniqueIp()
    const email = `it-nouser-${randomUUID()}@example.invalid`
    usedIps.push(ip)
    usedEmails.push(email)
    useClientIp(ip)
    const results = []
    for (let i = 0; i < 6; i++) results.push(await authSignIn({ email, password: 'wrong-password-123', next: null }))
    expect(results.slice(0, 5).map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(Array(5).fill('VALIDATION_FAILED'))
    const sixth = results[5]
    expect(sixth?.ok).toBe(false)
    if (sixth && !sixth.ok) {
      expect(sixth.error.code).toBe('RATE_LIMITED')
      expect(sixth.error.retryAfterSec).toBeGreaterThanOrEqual(1)
      expect(sixth.error.retryAfterSec).toBeLessThanOrEqual(900)
    }
    // a seventh attempt stays limited and does not add another audit row (only the first excess is audited, 07 5.1)
    const seventh = await authSignIn({ email, password: 'wrong-password-123', next: null })
    expect(seventh.ok).toBe(false)
    expect(await countAuditSince('auth.login_rate_limited', startedAt, { ip })).toBe(1)
    expect(await countAuditSince('auth.login_failed', startedAt, { ip })).toBe(5)
  })

  it('P1-4b the limit is per e-mail: a correct password is refused once limited (no oracle), another e-mail from the same IP is not limited', async () => {
    const ip = uniqueIp()
    const u = await makeUser('user')
    usedIps.push(ip)
    usedEmails.push(u.email)
    useClientIp(ip)
    for (let i = 0; i < 6; i++) await authSignIn({ email: u.email, password: 'wrong-password-123', next: null })
    const limited = await authSignIn({ email: u.email, password: u.password, next: null })
    expect(limited).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
    const other = `it-other-${randomUUID()}@example.invalid`
    usedEmails.push(other)
    await expect(authSignIn({ email: other, password: 'wrong-password-123', next: null })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
  })
})

describe.skipIf(!dbUp)('phase 1 (6) / T4: after a password reset the old session cookie no longer works', () => {
  it('P1-6 / S03-3 a session signed in before the reset is UNAUTHENTICATED afterwards (requireUser is what the pages call)', async () => {
    const adminUser = await makeUser('admin')
    const target = await makeUser('user')
    await signIn(target)
    await expect(requireUser()).resolves.toMatchObject({ userId: target.id })
    const oldCookies = new Map(jar.cookies)

    jar.cookies.clear()
    const out = await adminService.issuePasswordReset(ctxOf(adminUser, 'admin.issuePasswordReset'), { userId: target.id })
    await completePasswordReset(ctxOf(null, 'passwordReset.complete'), { token: tokenOf(out.resetUrl), password: strongPassword() })

    jar.cookies.clear()
    for (const [k, v] of oldCookies) jar.cookies.set(k, v)
    const err = await requireUser().catch((e: unknown) => e)
    expect(codeOf(err)).toBe('UNAUTHENTICATED')
  })
})

describe.skipIf(!dbUp)('phase 1 (7): the audit log keeps login / login_failed / invite.* (and the reset events)', () => {
  it('P1-7 invite.created / invite.revoked / invite.accepted / user.password_reset_* are recorded and carry no token and no password (F-002)', async () => {
    const adminUser = await makeUser('admin')
    const email = newEmail()
    const first = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    await adminService.revokeInvite(ctxOf(adminUser, 'admin.revokeInvite'), { inviteId: first.inviteId })
    const second = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    const password = strongPassword()
    await accept(ctxOf(null, 'invites.accept'), { token: tokenOf(second.inviteUrl), displayName: 'Audited', password })
    expect(await countAuditSince('invite.created', startedAt, { actorId: adminUser.id, targetId: first.inviteId })).toBe(1)
    expect(await countAuditSince('invite.revoked', startedAt, { actorId: adminUser.id, targetId: first.inviteId })).toBe(1)
    expect(await countAuditSince('invite.created', startedAt, { actorId: adminUser.id, targetId: second.inviteId })).toBe(1)
    expect(await countAuditSince('invite.accepted', startedAt, { targetId: second.inviteId })).toBe(1)

    const target = await makeUser('user')
    const out = await adminService.issuePasswordReset(ctxOf(adminUser, 'admin.issuePasswordReset'), { userId: target.id })
    await completePasswordReset(ctxOf(null, 'passwordReset.complete'), { token: tokenOf(out.resetUrl), password: strongPassword() })
    expect(await countAuditSince('user.password_reset_issued', startedAt, { actorId: adminUser.id, targetId: target.id })).toBe(1)
    expect(await countAuditSince('user.password_reset_completed', startedAt, { targetId: target.id })).toBe(1)

    const rows = await getDb().execute<{ metadata: unknown; target_id: string | null }>(
      sql`SELECT metadata, target_id FROM app.audit_logs WHERE occurred_at >= ${startedAt.toISOString()}::timestamptz AND target_id IN (${first.inviteId}, ${second.inviteId}, ${target.id})`,
    )
    const dump = JSON.stringify([...rows])
    for (const secret of [tokenOf(first.inviteUrl), tokenOf(second.inviteUrl), tokenOf(out.resetUrl), password]) expect(dump).not.toContain(secret)
  })

  it('P1-7b auth.login_failed (no actor) and auth.login (actor = the user) are written by the sign-in Action path', async () => {
    const ip = uniqueIp()
    const u = await makeUser('user')
    usedIps.push(ip)
    usedEmails.push(u.email)
    useClientIp(ip)
    await authSignIn({ email: u.email, password: 'wrong-password-123', next: null })
    expect(await countAuditSince('auth.login_failed', startedAt, { ip })).toBe(1)
    // a successful sign-in ends in redirect(); defineAction rethrows it, so swallow the Next.js redirect signal
    await authSignIn({ email: u.email, password: u.password, next: null }).catch(() => undefined)
    expect(await countAuditSince('auth.login', startedAt, { actorId: u.id, ip })).toBe(1)
  })
})

describe.skipIf(!dbUp)('appendix A T12 / T1: the invited address is fixed; unknown tokens look identical', () => {
  it('T12 the accept Action rejects an extra e-mail field (strict schema), so the address cannot be changed at registration', async () => {
    const adminUser = await makeUser('admin')
    const email = newEmail()
    const issued = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    const ttlMs = Date.parse(issued.expiresAt) - Date.now()
    expect(getConfig().INVITE_TTL_HOURS).toBeLessThanOrEqual(72) // 02 appendix A T12: valid for 72 hours at most
    expect(Math.abs(ttlMs - getConfig().INVITE_TTL_HOURS * 3_600_000)).toBeLessThan(5 * 60_000)
    const password = strongPassword()
    const res = await invitesAccept({
      token: tokenOf(issued.inviteUrl),
      displayName: 'Hijack',
      password,
      passwordConfirm: password,
      email: 'someone-else@example.invalid',
    })
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    await expect(getDb().transaction((tx) => profileEmailExists(tx, 'someone-else@example.invalid'))).resolves.toBe(false)
    await expect(getDb().transaction((tx) => profileEmailExists(tx, email))).resolves.toBe(false) // nothing was consumed either
  })

  it('T1 a well-formed but unknown token and a revoked token give the same inspect result', async () => {
    const adminUser = await makeUser('admin')
    const email = newEmail()
    const issued = await adminService.createInvite(ctxOf(adminUser, 'admin.createInvite'), { email, role: 'user' })
    await adminService.revokeInvite(ctxOf(adminUser, 'admin.revokeInvite'), { inviteId: issued.inviteId })
    const unknown = await invitesService.inspect(ctxOf(null, 'page:/invite'), 'A'.repeat(43), 'signup')
    const revoked = await invitesService.inspect(ctxOf(null, 'page:/invite'), tokenOf(issued.inviteUrl), 'signup')
    expect(revoked).toEqual(unknown)
    expect(unknown).toEqual({ valid: false })
  })
})
