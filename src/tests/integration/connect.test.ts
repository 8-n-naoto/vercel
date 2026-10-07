// WP-0.2 connectivity check against the dev Supabase project (npm run test:integration).
// Prints only the error class on failure; never prints connection strings.
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, pingDb, whoAmI } from '@/server/db/client'

describe('db connectivity (transaction pooler)', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('select 1', async () => {
    await expect(pingDb()).resolves.toBeUndefined()
  })

  it('current_user / current_database', async () => {
    const who = await whoAmI()
    // Role is postgres until HUMAN-TODO #8 (app_runtime) is done; only record it.
    console.error(`current_user=${who.currentUser} current_database=${who.currentDatabase}`)
    expect(who.currentDatabase).toBe('postgres')
  })
})
