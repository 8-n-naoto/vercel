// 07 13.3 AZ-01 / AZ-02 / AZ-05 / AZ-06, expanded over every registered Server Action (first version, WP-1.3).
// NOT RUN in WP-1.3 (dev DB unreachable). The matrix fills itself as actions are added under src/app/**/_actions/.
// defineAction validates input before authentication (06 3.1), so every action needs a valid input in AZ_INPUTS.
import { globSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', async () => (await import('./helpers/auth-fixture')).nextHeadersMock)

import { ACTION_BRAND } from '@/server/actions/brand'
import { closeDb, pingDb } from '@/server/db/client'
import { AZ_INPUTS } from '@/tests/fixtures/az-inputs'
import { cleanupTestUsers, createTestUser, disableUser, jar, resetUserState, revokeSessions, signIn, type TestUser } from './helpers/auth-fixture'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)

type Outcome = { ok: boolean; error?: { code: string } }
interface RegisteredAction {
  name: string
  auth: string
  run: (input: unknown) => Promise<Outcome>
}

const ROOT = process.cwd()
async function listActions(): Promise<RegisteredAction[]> {
  const out: RegisteredAction[] = []
  for (const f of globSync('src/app/**/_actions/*.ts', { cwd: ROOT })) {
    if (f.endsWith('.test.ts')) continue // a unit test next to an Action must not be imported here (its describe blocks would register in this file)
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ path.join(ROOT, f))
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function') continue
      const brand: unknown = Reflect.get(value, ACTION_BRAND)
      if (typeof brand !== 'object' || brand === null) continue
      const name: unknown = Reflect.get(brand, 'name')
      const auth: unknown = Reflect.get(brand, 'auth')
      if (typeof name !== 'string' || typeof auth !== 'string') continue
      const call: (input: unknown) => Promise<Outcome> = value as (input: unknown) => Promise<Outcome>
      out.push({ name, auth, run: (input) => call(input) })
    }
  }
  return out
}

const actions = dbUp ? await listActions() : []
const guarded = actions.filter((a) => a.auth === 'user' || a.auth === 'admin')
const adminOnly = actions.filter((a) => a.auth === 'admin')

afterAll(async () => {
  if (dbUp) await cleanupTestUsers()
  await closeDb()
})
beforeEach(() => jar.cookies.clear())

// One signed-in member is reused by every scenario: each scenario resets disabled_at / session_revoked_at and restores the cookies of the single
// sign-in. Signing in per scenario (about 50 calls from one IP) exceeds the Supabase Auth sign-in rate limit.
let shared: { user: TestUser; cookies: Map<string, string> } | null = null
async function sharedMember(): Promise<TestUser> {
  if (!shared) {
    const user = await createTestUser('user')
    await signIn(user)
    shared = { user, cookies: new Map(jar.cookies) }
  }
  await resetUserState(shared.user.id)
  jar.cookies.clear()
  for (const [k, v] of shared.cookies) jar.cookies.set(k, v)
  return shared.user
}

describe.skipIf(!dbUp)('authorization matrix over every user / admin action (07 13.3)', () => {
  it('every guarded action has a valid input in tests/fixtures/az-inputs.ts', () => {
    expect(guarded.filter((a) => !(a.name in AZ_INPUTS)).map((a) => a.name)).toEqual([])
  })

  for (const a of guarded) {
    it(`AZ-01 ${a.name}: no cookie -> UNAUTHENTICATED`, async () => {
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })
    it(`AZ-05 ${a.name}: disabled user -> UNAUTHENTICATED`, async () => {
      const u = await sharedMember()
      await disableUser(u.id)
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })
    it(`AZ-06 ${a.name}: session_revoked_at after the authentication time -> UNAUTHENTICATED`, async () => {
      const u = await sharedMember()
      await revokeSessions(u.id, new Date(Date.now() + 60_000))
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })
  }

  for (const a of adminOnly) {
    it(`AZ-02 ${a.name}: a member -> FORBIDDEN (the handler does not run)`, async () => {
      await sharedMember()
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    })
  }
})

// 02 10 phase 2 (2) / 07 13.3 AZ-02: the folder and member Actions are admin-only. The loops above expand over every registered Action,
// so this guard fails if one of them is ever registered with a weaker auth (or disappears from the matrix).
// AZ-03 / AZ-04 (view.*) are in integration/view.test.ts (see the view.* guard below).
describe.skipIf(!dbUp)('folders.* / members.* are in the matrix as admin-only (WP-3.5)', () => {
  for (const name of ['folders.create', 'folders.update', 'folders.delete', 'members.add', 'members.remove']) {
    it(`${name} is registered with auth: admin (AZ-01 / 02 / 05 / 06 run for it above)`, () => {
      expect(adminOnly.map((a) => a.name)).toContain(name)
    })
  }
})

// 02 10 phase 3 / appendix A: the upload and file Actions are admin-only. A member calling files.startUpload directly gets FORBIDDEN
// (AZ-02 above, with the valid input registered in AZ_INPUTS). This guard fails if one of them is registered with a weaker auth or disappears.
describe.skipIf(!dbUp)('files.* are in the matrix as admin-only (WP-4.7)', () => {
  for (const name of ['files.startUpload', 'files.finalizeUpload', 'files.cancelUpload', 'files.update', 'files.updateRestrictions', 'files.delete']) {
    it(`${name} is registered with auth: admin (AZ-01 / 02 / 05 / 06 run for it above)`, () => {
      expect(adminOnly.map((a) => a.name)).toContain(name)
    })
  }
  it('AZ-02 files.startUpload called directly by a member is FORBIDDEN', async () => {
    await sharedMember()
    const a = adminOnly.find((x) => x.name === 'files.startUpload')
    expect(await a?.run(AZ_INPUTS['files.startUpload'])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  })
})

// 02 10 phase 4 / 07 13.3 AZ-03 / AZ-04: the two viewing Actions are auth: 'user' (any signed-in user; the folder membership is checked inside the
// service), so they are NOT in the admin-only AZ-02 loop. AZ-01 / 05 / 06 run for them above. AZ-03 (a non-member gets NOT_FOUND view.not_found) and
// AZ-04 (a member gets a ticket) are in integration/view.test.ts. This guard fails if one of them is registered with another auth or disappears.
describe.skipIf(!dbUp)('view.* are in the matrix as auth: user (WP-5.6)', () => {
  for (const name of ['view.openAsMember', 'view.requestMemberDownload']) {
    it(`${name} is registered with auth: user (AZ-01 / 05 / 06 run for it above; AZ-03 / AZ-04 are in view.test.ts)`, () => {
      expect(guarded.filter((a) => a.auth === 'user').map((a) => a.name)).toContain(name)
      expect(adminOnly.map((a) => a.name)).not.toContain(name)
    })
  }
})
