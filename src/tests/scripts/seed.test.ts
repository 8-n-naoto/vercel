// WP-1.5: seed / seed-cleanup logic with mocked Auth and DB (no network, no DB). Covers APP_ENV guard, SEED_PASSWORD, idempotency, no password output.
import { describe, expect, it, vi } from 'vitest'
import { runCleanup, runSeed, SEED_EMAILS, type SeedContext } from '../../../scripts/seed-lib'

const PASSWORD = 'unit-test-password-123'

function makeCtx(env: Record<string, string | undefined>, existing: string[] = []) {
  const users = new Map<string, string>(existing.map((e, i) => [e, `id-${i}`]))
  const lines: string[] = []
  const auth = {
    findUserIdByEmail: vi.fn(async (e: string) => users.get(e) ?? null),
    createUser: vi.fn(async (e: string) => {
      const id = `new-${users.size}`
      users.set(e, id)
      return id
    }),
    deleteUser: vi.fn(async () => {}),
  }
  const db = {
    upsertProfile: vi.fn(async () => {}),
    findFolderId: vi.fn(async (): Promise<string | null> => null),
    createFolder: vi.fn(async () => 'folder-1'),
    addMember: vi.fn(async () => {}),
    profileIdsByEmail: vi.fn(async () => [{ id: 'a', email: 'seed-admin@example.com' }]),
    seedFolderIds: vi.fn(async () => ['folder-1']),
    deleteMembers: vi.fn(async () => {}),
    deleteFolders: vi.fn(async () => {}),
    deleteProfiles: vi.fn(async () => {}),
  }
  const ctx: SeedContext = { env, auth, db, log: (l) => lines.push(l) }
  return { ctx, auth, db, lines }
}
const noCalls = (m: object) => Object.values(m).every((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length === 0)

describe('seed', () => {
  it('(a) second run does not call createUser', async () => {
    const first = makeCtx({ APP_ENV: 'local', SEED_PASSWORD: PASSWORD })
    expect(await runSeed(first.ctx)).toBe(0)
    expect(first.auth.createUser).toHaveBeenCalledTimes(3)
    const second = makeCtx({ APP_ENV: 'local', SEED_PASSWORD: PASSWORD }, [...SEED_EMAILS])
    second.db.findFolderId.mockResolvedValue('folder-1')
    expect(await runSeed(second.ctx)).toBe(0)
    expect(second.auth.createUser).not.toHaveBeenCalled()
    expect(second.db.createFolder).not.toHaveBeenCalled()
    expect(second.db.addMember).toHaveBeenCalledTimes(1) // member only; ON CONFLICT DO NOTHING in SQL
  })

  it('(b) APP_ENV=production calls nothing and returns non-zero', async () => {
    for (const run of [runSeed, runCleanup]) {
      const t = makeCtx({ APP_ENV: 'production', SEED_PASSWORD: PASSWORD })
      expect(await run(t.ctx)).not.toBe(0)
      expect(noCalls(t.auth)).toBe(true)
      expect(noCalls(t.db)).toBe(true)
    }
  })

  it('(c) missing or short SEED_PASSWORD calls nothing and names only the variable', async () => {
    for (const pw of [undefined, 'qz9-1234567']) {
      const t = makeCtx({ APP_ENV: 'local', SEED_PASSWORD: pw })
      expect(await runSeed(t.ctx)).not.toBe(0)
      expect(noCalls(t.auth)).toBe(true)
      expect(noCalls(t.db)).toBe(true)
      expect(t.lines.join('\n')).toContain('SEED_PASSWORD')
      if (pw) expect(t.lines.join('\n')).not.toContain(pw)
    }
  })

  it('(d) output never contains the password', async () => {
    const t = makeCtx({ APP_ENV: 'test', SEED_PASSWORD: PASSWORD })
    await runSeed(t.ctx)
    expect(t.lines.length).toBeGreaterThan(0)
    expect(t.lines.join('\n')).not.toContain(PASSWORD)
  })

  it('cleanup deletes in FK order and only for the seed e-mails', async () => {
    const order: string[] = []
    const t = makeCtx({ APP_ENV: 'local' }, [...SEED_EMAILS])
    t.db.deleteMembers.mockImplementation(async () => void order.push('members'))
    t.db.deleteFolders.mockImplementation(async () => void order.push('folders'))
    t.db.deleteProfiles.mockImplementation(async () => void order.push('profiles'))
    t.auth.deleteUser.mockImplementation(async () => void order.push('auth'))
    expect(await runCleanup(t.ctx)).toBe(0)
    expect(order).toEqual(['members', 'folders', 'profiles', 'auth', 'auth', 'auth'])
    expect(t.db.profileIdsByEmail).toHaveBeenCalledWith(SEED_EMAILS)
  })
})
