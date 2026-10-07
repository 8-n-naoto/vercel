import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { MemberList, MemberViewForMember } from '@/lib/dto'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { membersService, type MemberDeps, type MemberRow, type MemberTx } from './members'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const U1 = '00000000-0000-4000-8000-000000000021'
const U2 = '00000000-0000-4000-8000-000000000022'
const ctxOf = (role: 'admin' | 'user'): ServiceContext => ({
  actor: { userId: 'a1', email: 'a1@example.com', displayName: 'A1', role },
  requestMeta: { ip: null, userAgent: null, requestId: 'r1' },
  now: new Date('2026-10-08T00:00:00.000Z'),
  actionName: 'members.test',
})
const admin = ctxOf('admin')

async function shapeOf(p: Promise<unknown>): Promise<AppError['shape'] | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape
    throw e
  }
}

type P = { id: string; role: 'admin' | 'user'; disabledAt: Date | null; displayName: string }
const user = (id: string, name: string, over: Partial<P> = {}): P => ({ id, role: 'user', disabledAt: null, displayName: name, ...over })

function setup(over: { profiles?: P[]; existing?: string[]; removable?: boolean } = {}) {
  const calls: string[] = []
  const profiles = over.profiles ?? [user(U1, 'One'), user(U2, 'Two')]
  const tx: MemberTx = {
    assertManage: vi.fn(async (_f, lock) => {
      calls.push(`assert:${lock}`)
      return { id: FOLDER }
    }),
    lockProfiles: vi.fn(async () => {
      calls.push('lockProfiles')
      return profiles
    }),
    insertMembers: vi.fn<MemberTx['insertMembers']>(async (_f, ids) => {
      calls.push('insert')
      return ids.filter((id) => !(over.existing ?? []).includes(id))
    }),
    deleteMember: vi.fn(async () => over.removable ?? true),
    displayNameOf: vi.fn(async () => 'One'),
    auditAdded: vi.fn(async (_f, id) => void calls.push(`added:${id}`)),
    auditRemoved: vi.fn(async (_f, id) => void calls.push(`removed:${id}`)),
  }
  const deps: MemberDeps = {
    transaction: async (_ctx, fn) => {
      const r = await fn(tx)
      calls.push('commit')
      return r
    },
    assertFolder: vi.fn(async () => ({ access: 'member' as const })),
    listRows: vi.fn(async () => []),
    listCandidateRows: vi.fn(async () => []),
  }
  return { deps, tx, calls }
}

describe('members.add (06 6.4)', () => {
  it('adds everyone, one audit row each, FOR SHARE on the folder', async () => {
    const s = setup()
    expect(await membersService.add(admin, { folderId: FOLDER, userIds: [U1, U2] }, s.deps)).toEqual({ added: 2, skipped: 0 })
    expect(s.calls).toEqual(['assert:share', 'lockProfiles', 'insert', `added:${U1}`, `added:${U2}`, 'commit'])
  })

  it('counts existing members as skipped and audits only the inserted ones (D-018 c)', async () => {
    const s = setup({ existing: [U1] })
    expect(await membersService.add(admin, { folderId: FOLDER, userIds: [U1, U2] }, s.deps)).toEqual({ added: 1, skipped: 1 })
    expect(s.calls).toContain(`added:${U2}`)
    expect(s.calls).not.toContain(`added:${U1}`)
  })

  it.each([
    ['an unknown id (count mismatch)', [user(U1, 'One')]],
    ['an admin', [user(U1, 'One'), user(U2, 'Two', { role: 'admin' })]],
    ['a disabled user', [user(U1, 'One'), user(U2, 'Two', { disabledAt: new Date(0) })]],
  ])('%s rejects the whole request with fieldErrors.userIds and inserts nothing', async (_n, profiles) => {
    const s = setup({ profiles })
    const e = await shapeOf(membersService.add(admin, { folderId: FOLDER, userIds: [U1, U2] }, s.deps))
    expect(e?.code).toBe('VALIDATION_FAILED')
    expect(e?.fieldErrors?.['userIds']).toHaveLength(1)
    expect(s.calls).not.toContain('insert')
  })

  it('a folder that is not visible stops before any profile is locked (NOT_FOUND from assertFolderRole)', async () => {
    const s = setup()
    vi.mocked(s.tx.assertManage).mockRejectedValueOnce(new AppError({ code: 'NOT_FOUND', message: 'x' }))
    expect((await shapeOf(membersService.add(admin, { folderId: FOLDER, userIds: [U1] }, s.deps)))?.code).toBe('NOT_FOUND')
    expect(s.tx.lockProfiles).not.toHaveBeenCalled()
  })
})

describe('members.remove (06 6.5)', () => {
  it('deletes and audits', async () => {
    const s = setup()
    await membersService.remove(admin, { folderId: FOLDER, userId: U1 }, s.deps)
    expect(s.calls).toEqual(['assert:share', `removed:${U1}`, 'commit'])
  })
  it('a user who is not a member is NOT_FOUND and nothing is audited', async () => {
    const s = setup({ removable: false })
    expect((await shapeOf(membersService.remove(admin, { folderId: FOLDER, userId: U1 }, s.deps)))?.code).toBe('NOT_FOUND')
    expect(s.tx.auditRemoved).not.toHaveBeenCalled()
  })
})

describe('members.list / listCandidates (06 9.5 / 9.6)', () => {
  const row: MemberRow = { userId: U1, displayName: 'One', email: 'one@example.com', addedAt: new Date('2026-10-01T00:00:00Z'), disabledAt: new Date('2026-10-02T00:00:00Z') }

  it('admin: email, addedAt and disabled; disabled users are requested', async () => {
    const s = setup()
    vi.mocked(s.deps.assertFolder).mockResolvedValue({ access: 'admin' })
    vi.mocked(s.deps.listRows).mockResolvedValue([row])
    const r = await membersService.list(admin, FOLDER, s.deps)
    expect(r).toEqual({ access: 'admin', members: [{ userId: U1, displayName: 'One', email: 'one@example.com', addedAt: '2026-10-01T00:00:00.000Z', disabled: true }] })
    expect(s.deps.listRows).toHaveBeenCalledWith(FOLDER, true)
  })

  it('member: userId and displayName only (no e-mail at runtime either); disabled users are not requested', async () => {
    const s = setup()
    vi.mocked(s.deps.listRows).mockResolvedValue([row])
    const r = await membersService.list(ctxOf('user'), FOLDER, s.deps)
    expect(r).toEqual({ access: 'member', members: [{ userId: U1, displayName: 'One' }] })
    expect(JSON.stringify(r)).not.toContain('@')
    expect(s.deps.listRows).toHaveBeenCalledWith(FOLDER, false)
  })

  it('the member view has no email at type level (06 2)', () => {
    expectTypeOf<MemberViewForMember>().not.toHaveProperty('email')
    expectTypeOf<Extract<MemberList, { access: 'member' }>['members'][number]>().not.toHaveProperty('email')
    expectTypeOf<Extract<MemberList, { access: 'admin' }>['members'][number]>().toHaveProperty('email')
  })

  it('a non-uuid folder id is NOT_FOUND without a query', async () => {
    const s = setup()
    expect((await shapeOf(membersService.list(admin, 'abc', s.deps)))?.code).toBe('NOT_FOUND')
    expect((await shapeOf(membersService.listCandidates(admin, 'abc', s.deps)))?.code).toBe('NOT_FOUND')
    expect(s.deps.assertFolder).not.toHaveBeenCalled()
  })

  it('listCandidates requires manage (a member would get FORBIDDEN from assertFolderRole)', async () => {
    const s = setup()
    vi.mocked(s.deps.assertFolder).mockRejectedValueOnce(new AppError({ code: 'FORBIDDEN', message: 'x' }))
    expect((await shapeOf(membersService.listCandidates(ctxOf('user'), FOLDER, s.deps)))?.code).toBe('FORBIDDEN')
    expect(s.deps.assertFolder).toHaveBeenCalledWith(expect.anything(), FOLDER, 'manage')
    expect(s.deps.listCandidateRows).not.toHaveBeenCalled()
  })
})
