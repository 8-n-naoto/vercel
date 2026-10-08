// 07 5.2 RL-30 / RL-33 (integration) and the D-021 IPv6 /64 behaviour against a real database. Skipped when the dev database is unreachable.
// NOT RUN yet (T-060): the dev DB was not reachable; test-runner runs it after the connection is restored (npm run test:integration).
// Route (a): the real Action `viewOpenAsMember` is called, so defineAction's rate limit wrapper is exercised (next/headers is mocked by the jar).
// Test fixture only: counters, access_logs and audit rows of throw-away users are removed afterwards.
// eslint-disable-next-line no-restricted-imports
import { and, eq, gte, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { viewOpenAsMember, viewRequestMemberDownload } from '@/app/_actions/view'
import { closeDb, getDb, pingDb } from '@/server/db/client'
import { accessLogs, auditLogs, files, rateLimits } from '@/server/db/schema'
import { deleteRateLimitsByKeyPrefix, incrementRateLimit } from '@/server/repositories/rate-limits'
import { rateLimitKey } from '@/server/security/rate-limit'
import { cleanupTestUsers, createTestUser, jar, signIn } from './helpers/auth-fixture'
import { addMemberRow, cleanupFolderFixtures, createFileRow, createFolderRow } from './helpers/folder-fixture'
import { purgeAuditOfTestUsers, resetClientIp, uniqueIp, useClientIp } from './helpers/phase2-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

const fileIds: string[] = []
const counterPrefixes: string[] = []
const ipPrefixes: string[] = []

beforeEach(() => {
  jar.cookies.clear()
  resetClientIp()
})

afterAll(async () => {
  if (dbUp) {
    for (const p of [...counterPrefixes, ...ipPrefixes]) await deleteRateLimitsByKeyPrefix(p)
    if (fileIds.length) await getDb().delete(accessLogs).where(inArray(accessLogs.fileId, fileIds))
    await cleanupFolderFixtures()
    await purgeAuditOfTestUsers()
    await cleanupTestUsers()
  }
  await closeDb()
})

describe.skipIf(!dbUp)('ticket:user rate limit (07 5.2 RL-30)', () => {
  it('RL-30 the 31st view.openAsMember of one member is RATE_LIMITED: access_logs +30, one security.rate_limited audit (rule ticket:user), none more on the 32nd', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const folderId = await createFolderRow(admin.id)
    await addMemberRow(folderId, member.id, admin.id)
    const fileId = await createFileRow(folderId, admin.id)
    fileIds.push(fileId)
    // Fresh member => fresh counters; purge anyway so a rerun inside the 60 s window cannot inherit counts.
    counterPrefixes.push(rateLimitKey('ticket:user', { userId: member.id }), rateLimitKey('mutation:user', { userId: member.id }))

    await signIn(member)
    useClientIp(uniqueIp())
    const since = new Date(Date.now() - 1000)
    const logCount = async () => (await getDb().select({ id: accessLogs.id }).from(accessLogs).where(eq(accessLogs.fileId, fileId))).length
    const auditCount = async () =>
      (
        await getDb()
          .select({ id: auditLogs.id, metadata: auditLogs.metadata })
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'security.rate_limited'), eq(auditLogs.actorId, member.id), gte(auditLogs.occurredAt, since)))
      ).length

    for (let i = 1; i <= 30; i++) {
      const r = await viewOpenAsMember({ fileId })
      expect(r.ok, `call ${i}: ${r.ok ? 'ok' : r.error.code}`).toBe(true)
    }
    expect(await logCount()).toBe(30)
    expect(await auditCount()).toBe(0)

    const r31 = await viewOpenAsMember({ fileId })
    expect(r31.ok).toBe(false)
    if (!r31.ok) {
      expect(r31.error.code).toBe('RATE_LIMITED')
      expect(r31.error.retryAfterSec).toBeGreaterThan(0)
    }
    expect(await logCount()).toBe(30) // the rejected call never reached the handler
    const rows = await getDb()
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'security.rate_limited'), eq(auditLogs.actorId, member.id), gte(auditLogs.occurredAt, since)))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.metadata).toEqual({ rule: 'ticket:user' })

    const r32 = await viewOpenAsMember({ fileId })
    expect(r32.ok).toBe(false)
    if (!r32.ok) expect(r32.error.code).toBe('RATE_LIMITED')
    expect(await logCount()).toBe(30)
    expect(await auditCount()).toBe(1) // only the first excess is audited
  })
})

describe.skipIf(!dbUp)('download:user rate limit (07 5.2 RL-33)', () => {
  it('RL-33 the 21st view.requestMemberDownload of one member is RATE_LIMITED: access_logs +20, one security.rate_limited audit (rule download:user), none more on the 22nd; ticket:user is not counted', async () => {
    const admin = await createTestUser('admin')
    const member = await createTestUser('user')
    const folderId = await createFolderRow(admin.id)
    await addMemberRow(folderId, member.id, admin.id)
    const fileId = await createFileRow(folderId, admin.id)
    fileIds.push(fileId)
    // files.download_allowed defaults to false (05): without this the first call is ACCESS_DENIED (DOWNLOAD_NOT_ALLOWED).
    await getDb().update(files).set({ downloadAllowed: true }).where(eq(files.id, fileId))
    const downloadKey = rateLimitKey('download:user', { userId: member.id })
    const ticketKey = rateLimitKey('ticket:user', { userId: member.id })
    counterPrefixes.push(downloadKey, ticketKey, rateLimitKey('mutation:user', { userId: member.id }))

    await signIn(member)
    useClientIp(uniqueIp())
    const since = new Date(Date.now() - 1000)
    const logCount = async () => (await getDb().select({ id: accessLogs.id }).from(accessLogs).where(eq(accessLogs.fileId, fileId))).length
    const auditRows = async () =>
      getDb()
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'security.rate_limited'), eq(auditLogs.actorId, member.id), gte(auditLogs.occurredAt, since)))
    const counterRows = async (key: string) => (await getDb().select({ count: rateLimits.count }).from(rateLimits).where(eq(rateLimits.key, key))).length

    for (let i = 1; i <= 20; i++) {
      const r = await viewRequestMemberDownload({ fileId })
      expect(r.ok, `call ${i}: ${r.ok ? 'ok' : r.error.code}`).toBe(true)
    }
    expect(await logCount()).toBe(20)
    expect(await auditRows()).toHaveLength(0)

    const r21 = await viewRequestMemberDownload({ fileId })
    expect(r21.ok).toBe(false)
    if (!r21.ok) {
      expect(r21.error.code).toBe('RATE_LIMITED')
      expect(r21.error.retryAfterSec).toBeGreaterThan(0)
    }
    expect(await logCount()).toBe(20)
    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.metadata).toEqual({ rule: 'download:user' })

    const r22 = await viewRequestMemberDownload({ fileId })
    expect(r22.ok).toBe(false)
    if (!r22.ok) expect(r22.error.code).toBe('RATE_LIMITED')
    expect(await auditRows()).toHaveLength(1)

    expect(await counterRows(ticketKey)).toBe(0) // separate counter: ticket:user was never touched
    expect(await counterRows(downloadKey)).toBeGreaterThan(0)
  })
})

describe.skipIf(!dbUp)('IPv6 /64 rounding of rate limit keys (D-021)', () => {
  it('two addresses in the same /64 share one counter; another /64 has its own', async () => {
    const base = uniqueIp() // 2001:db8:<a>:<b>::1
    const sameNet = base.replace(/::1$/, ':abcd:1234:5678:9abc')
    const otherNet = uniqueIp()
    const k1 = rateLimitKey('raw:ip', { ip: base })
    const k2 = rateLimitKey('raw:ip', { ip: sameNet })
    const k3 = rateLimitKey('raw:ip', { ip: otherNet })
    ipPrefixes.push(k1, k3)
    expect(k2).toBe(k1)
    expect(k3).not.toBe(k1)

    expect((await incrementRateLimit(k1, 60)).count).toBe(1)
    expect((await incrementRateLimit(k2, 60)).count).toBe(2) // same row
    expect((await incrementRateLimit(k3, 60)).count).toBe(1) // different /64
  })
})
