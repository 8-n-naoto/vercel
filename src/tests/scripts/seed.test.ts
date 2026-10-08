// WP-1.5: seed / seed-cleanup logic with mocked Auth and DB (no network, no DB). Covers APP_ENV guard, SEED_PASSWORD, idempotency, no password output.
import { describe, expect, it, vi } from 'vitest'
import { runCleanup, runSeed, SEED_EMAILS, SEED_EXTRA_MEMBERS_MAX, type SeedContext } from '../../../scripts/seed-lib'

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
    profileIdsByEmail: vi.fn(async (emails: readonly string[]) => (emails.length >= 0 ? [{ id: 'a', email: 'seed-admin@example.com' }] : [])),
    seedFolderIds: vi.fn(async () => ['folder-1']),
    deleteMembers: vi.fn(async () => {}),
    deleteFolders: vi.fn(async () => {}),
    deleteProfiles: vi.fn(async (ids: readonly string[]) => void ids.length),
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

describe('seed extra members (SEED_EXTRA_MEMBERS)', () => {
  const base = { APP_ENV: 'local', SEED_PASSWORD: PASSWORD }
  const memberEmail = (n: number) => `seed-member-${n}@example.com`

  it('=4 creates 7 accounts and 5 members (seed-member-2..5)', async () => {
    const t = makeCtx({ ...base, SEED_EXTRA_MEMBERS: '4' })
    expect(await runSeed(t.ctx)).toBe(0)
    expect(t.auth.createUser).toHaveBeenCalledTimes(7)
    expect(t.db.upsertProfile).toHaveBeenCalledTimes(7)
    expect(t.db.addMember).toHaveBeenCalledTimes(5)
    const created = t.auth.createUser.mock.calls.map((c) => c[0])
    for (const n of [2, 3, 4, 5]) expect(created).toContain(memberEmail(n))
    expect(created).not.toContain(memberEmail(6))
    expect(t.lines.join('\n')).toContain('seed-member-5@example.com  user  created')
    expect(t.lines.join('\n')).not.toContain(PASSWORD)
  })

  it('is idempotent with extra members (second run reuses)', async () => {
    const all = [...SEED_EMAILS, ...[2, 3, 4, 5].map(memberEmail)]
    const t = makeCtx({ ...base, SEED_EXTRA_MEMBERS: '4' }, all)
    t.db.findFolderId.mockResolvedValue('folder-1')
    expect(await runSeed(t.ctx)).toBe(0)
    expect(t.auth.createUser).not.toHaveBeenCalled()
    expect(t.db.addMember).toHaveBeenCalledTimes(5)
    expect(t.lines.join('\n')).toContain('seed-member-2@example.com  user  reused')
  })

  it('unset, empty and 0 keep the default (3 accounts + 1 member)', async () => {
    for (const v of [undefined, '', '0']) {
      const t = makeCtx({ ...base, SEED_EXTRA_MEMBERS: v })
      expect(await runSeed(t.ctx)).toBe(0)
      expect(t.auth.createUser).toHaveBeenCalledTimes(3)
      expect(t.db.addMember).toHaveBeenCalledTimes(1)
    }
  })

  it('19 is the maximum and creates seed-member-2..20', async () => {
    const t = makeCtx({ ...base, SEED_EXTRA_MEMBERS: String(SEED_EXTRA_MEMBERS_MAX) })
    expect(await runSeed(t.ctx)).toBe(0)
    expect(t.auth.createUser).toHaveBeenCalledTimes(3 + 19)
    expect(t.lines.join('\n')).toContain(memberEmail(20))
  })

  it('invalid values (20, abc, -1, 1.5) call nothing, return non-zero and name only the variable', async () => {
    for (const v of ['20', 'abc', '-1', '1.5']) {
      const t = makeCtx({ ...base, SEED_EXTRA_MEMBERS: v })
      expect(await runSeed(t.ctx)).not.toBe(0)
      expect(noCalls(t.auth)).toBe(true)
      expect(noCalls(t.db)).toBe(true)
      expect(t.lines.join('\n')).toContain('SEED_EXTRA_MEMBERS')
      expect(t.lines.join('\n')).not.toContain(PASSWORD)
    }
  })

  it('cleanup targets seed-member-2..20 regardless of SEED_EXTRA_MEMBERS and skips absent ones', async () => {
    const present = [memberEmail(2), memberEmail(5)]
    const t = makeCtx({ APP_ENV: 'local' }, [...SEED_EMAILS, ...present])
    const asked: string[] = []
    const deleted: string[] = []
    t.db.profileIdsByEmail.mockImplementation(async (emails: readonly string[]) => {
      asked.push(...emails)
      return emails.filter((e) => e === 'seed-admin@example.com' || present.includes(e)).map((e) => ({ id: `id-${e}`, email: e }))
    })
    t.db.deleteProfiles.mockImplementation(async (ids: readonly string[]) => void deleted.push(...ids))
    expect(await runCleanup(t.ctx)).toBe(0)
    for (let n = 2; n <= 20; n++) expect(asked).toContain(memberEmail(n))
    expect(asked).not.toContain(memberEmail(21))
    expect(t.auth.deleteUser).toHaveBeenCalledTimes(5) // 3 fixed + 2 extra; absent extras are skipped
    expect(deleted).toEqual(expect.arrayContaining([`id-${memberEmail(2)}`, `id-${memberEmail(5)}`]))
    expect(t.lines.join('\n')).not.toContain(memberEmail(3))
  })
})
