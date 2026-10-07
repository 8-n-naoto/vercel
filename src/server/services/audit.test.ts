import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { AUDIT_ACTIONS } from '@/lib/domain'
import { AUDIT_ACTION_LABELS } from '@/lib/messages'
import type { ServiceContext } from '@/server/actions/define-action'
import { getDb } from '@/server/db/client'
import { generateToken } from '@/server/security/tokens'
import { insertAuditLog } from '@/server/repositories/audit-logs'
import { assertSafeMetadata, AUDIT_METADATA_KEYS, record, type AuditMetadata } from './audit'

vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/server/repositories/audit-logs', () => ({ insertAuditLog: vi.fn(async () => {}) }))

const ctx: ServiceContext = {
  actor: { userId: 'u1', email: 'a@example.com', displayName: 'A', role: 'admin' },
  requestMeta: { ip: '203.0.113.5', userAgent: 'vitest', requestId: 'r1' },
  now: new Date('2026-10-08T00:00:00Z'),
  actionName: 'test.action',
}
const executor = getDb() // mocked: an empty object

beforeEach(() => vi.mocked(insertAuditLog).mockClear())

// 08 9.3 (docs is not in CI: skipped when the file is missing)
const spec08 = new URL('../../../docs/08_フロントエンド実装仕様.md', import.meta.url)
const hasSpec08 = existsSync(spec08)

describe('AUDIT_ACTIONS vs 08 9.3', () => {
  it.skipIf(!hasSpec08)('1:1 with the action table, display names equal AUDIT_ACTION_LABELS', () => {
    const md = readFileSync(spec08, 'utf8')
    const start = md.indexOf('監査ログの操作名（`AuditAction`')
    expect(start).toBeGreaterThan(-1)
    const section = md.slice(start, md.indexOf('### 9.4', start))
    const pairs = new Map<string, string>()
    for (const line of section.split('\n')) {
      const cells = line.split('|').map((c) => c.trim())
      for (let i = 1; i + 1 < cells.length; i += 2) {
        const a = cells[i]
        const label = cells[i + 1]
        if (a && label && /^[a-z_]+\.[a-z_]+$/.test(a)) pairs.set(a, label)
      }
    }
    expect([...pairs.keys()].sort()).toEqual([...AUDIT_ACTIONS].sort())
    for (const [a, label] of pairs) expect(AUDIT_ACTION_LABELS[a as keyof typeof AUDIT_ACTION_LABELS]).toBe(label)
  })
  it('allowed-key table covers every action and nothing else', () => {
    expect(Object.keys(AUDIT_METADATA_KEYS).sort()).toEqual([...AUDIT_ACTIONS].sort())
  })
})

describe('audit metadata carries no secrets', () => {
  it('type level: tokens / passwords / hashes are not allowed keys', () => {
    expectTypeOf<AuditMetadata['share_link.created']>().not.toHaveProperty('token')
    expectTypeOf<AuditMetadata['share_link.created']>().not.toHaveProperty('password')
    expectTypeOf<AuditMetadata['invite.created']>().not.toHaveProperty('token')
    expectTypeOf<AuditMetadata['security.rate_limited']>().not.toHaveProperty('key')
    expectTypeOf<AuditMetadata['auth.login_failed']>().not.toHaveProperty('email')
    expectTypeOf<AuditMetadata['user.password_reset_issued']>().not.toHaveProperty('token')
  })
  it('no allowed top-level key looks secret (except the documented safe ones)', () => {
    const safe = new Set(['emailHash', 'tokenHint', 'newTokenHint', 'hasPassword'])
    for (const keys of Object.values(AUDIT_METADATA_KEYS)) {
      for (const k of keys) if (!safe.has(k)) expect(k).not.toMatch(/token|password|secret|cookie|ticket|hash|key/i)
    }
  })
  it('rejects a key outside the allow-list', () => {
    expect(() => assertSafeMetadata('share_link.created', { token: 'x' })).toThrow(/not allowed/)
    expect(() => assertSafeMetadata('auth.login', { password: 'x' })).toThrow(/not allowed/)
  })
  it('rejects secret-looking nested keys', () => {
    expect(() => assertSafeMetadata('file.updated', { before: { password: 'x' }, after: {} })).toThrow(/looks secret/)
  })
  it('rejects a token-shaped value and does not echo it', () => {
    const t = generateToken()
    let message = ''
    try {
      assertSafeMetadata('folder.created', { name: t })
    } catch (e) {
      message = e instanceof Error ? e.message : ''
    }
    expect(message).toMatch(/token/)
    expect(message).not.toContain(t)
  })
  it('accepts the documented values (hash, hint, hasPassword)', () => {
    expect(() => assertSafeMetadata('auth.login_failed', { emailHash: 'a'.repeat(64), reason: 'invalid_credentials' })).not.toThrow()
    expect(() =>
      assertSafeMetadata('share_link.created', {
        fileId: 'f', label: 'l', expiresAt: '2026-10-15T00:00:00Z', maxViews: null, hasPassword: true, downloadAllowed: false, tokenHint: 'abcd',
      }),
    ).not.toThrow()
  })
})

describe('record', () => {
  it('writes actor, ip, user agent and defaults', async () => {
    await record(executor, ctx, { action: 'folder.created', target: { type: 'folder', id: 'F1' }, folderId: 'F1', metadata: { name: 'x' } })
    expect(insertAuditLog).toHaveBeenCalledWith(executor, {
      actorId: 'u1', action: 'folder.created', targetType: 'folder', targetId: 'F1', folderId: 'F1', result: 'success',
      metadata: { name: 'x' }, ip: '203.0.113.5', userAgent: 'vitest',
    })
  })
  it('null actor and actorOverride', async () => {
    await record(executor, { ...ctx, actor: null }, { action: 'auth.login_rate_limited', metadata: { rule: 'login:ip' } })
    expect(vi.mocked(insertAuditLog).mock.calls[0]?.[1]).toMatchObject({ actorId: null, targetType: null, targetId: null })
    await record(executor, { ...ctx, actor: null }, { action: 'invite.accepted', actorOverride: 'new-user', metadata: { userId: 'new-user', role: 'user' } })
    expect(vi.mocked(insertAuditLog).mock.calls[1]?.[1]).toMatchObject({ actorId: 'new-user' })
  })
  it('does not write when the metadata is unsafe', async () => {
    const bad = { token: generateToken() } // a variable (not a literal) is assignable to the empty metadata type, so only the runtime guard stops it
    await expect(record(executor, ctx, { action: 'auth.login', metadata: bad })).rejects.toThrow()
    expect(insertAuditLog).not.toHaveBeenCalled()
  })
})
