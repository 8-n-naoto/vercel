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
import { cleanupTestUsers, createTestUser, disableUser, jar, revokeSessions, signIn } from './helpers/auth-fixture'

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

describe.skipIf(!dbUp)('authorization matrix over every user / admin action (07 13.3)', () => {
  it('every guarded action has a valid input in tests/fixtures/az-inputs.ts', () => {
    expect(guarded.filter((a) => !(a.name in AZ_INPUTS)).map((a) => a.name)).toEqual([])
  })

  for (const a of guarded) {
    it(`AZ-01 ${a.name}: no cookie -> UNAUTHENTICATED`, async () => {
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })
    it(`AZ-05 ${a.name}: disabled user -> UNAUTHENTICATED`, async () => {
      const u = await createTestUser('user')
      await signIn(u)
      await disableUser(u.id)
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })
    it(`AZ-06 ${a.name}: session_revoked_at after the authentication time -> UNAUTHENTICATED`, async () => {
      const u = await createTestUser('user')
      await signIn(u)
      await revokeSessions(u.id, new Date(Date.now() + 60_000))
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    })
  }

  for (const a of adminOnly) {
    it(`AZ-02 ${a.name}: a member -> FORBIDDEN (the handler does not run)`, async () => {
      const u = await createTestUser('user')
      await signIn(u)
      expect(await a.run(AZ_INPUTS[a.name])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    })
  }
})
