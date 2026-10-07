// 02 10 phase 1 (3) / 04 5.8: the public Supabase Auth endpoints must refuse sign-up with the publishable key.
// NOT RUN in WP-2.7: no dev Supabase connection yet (HT #11). Skipped unless APP_ENV is local / test and the URL and key are set.
// It sends a request to the dev project only. If sign-up were enabled, the created user is removed again and the test fails.
import { describe, expect, it } from 'vitest'
import { createSupabaseAdminClient } from '@/server/auth/supabase-admin'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY
const envOk = (process.env.APP_ENV === 'local' || process.env.APP_ENV === 'test') && !!url && !!key

interface Probe {
  status: number
  body: Record<string, unknown>
}

async function post(path: string, body: unknown): Promise<Probe> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { apikey: key ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const parsed: unknown = await res.json().catch(() => ({}))
  return { status: res.status, body: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {} }
}

/** A created user shows up as `id` (confirmation off) or `user.id`. Removes it and returns its id, or null. */
async function removeIfCreated(p: Probe): Promise<string | null> {
  const user = p.body.user
  const id = typeof p.body.id === 'string' ? p.body.id : typeof user === 'object' && user !== null && typeof Reflect.get(user, 'id') === 'string' ? String(Reflect.get(user, 'id')) : null
  if (id) await createSupabaseAdminClient().auth.admin.deleteUser(id)
  return id
}

describe.skipIf(!envOk)('public Auth endpoints refuse sign-up (02 10 phase 1 (3), 04 5.8)', () => {
  it('5.8 (1): POST /auth/v1/signup with e-mail and password is refused (4xx, no user, no session)', async () => {
    const p = await post('/auth/v1/signup', { email: `it-signup-probe-${crypto.randomUUID()}@example.invalid`, password: 'probe-password-123456' })
    const created = await removeIfCreated(p)
    expect(created, 'a user was created: fix Authentication > Sign In / Providers > Allow new users to sign up').toBeNull()
    expect(p.status).toBeGreaterThanOrEqual(400)
    expect(p.status).toBeLessThan(500)
    expect(p.body.access_token).toBeUndefined()
    if (typeof p.body.error_code === 'string') expect(p.body.error_code).toBe('signup_disabled')
  })

  it('5.8 (2): anonymous sign-in (POST /auth/v1/signup with an empty body) is refused (4xx, no session)', async () => {
    const p = await post('/auth/v1/signup', {})
    const created = await removeIfCreated(p)
    expect(created, 'an anonymous user was created: turn off Anonymous sign-ins').toBeNull()
    expect(p.status).toBeGreaterThanOrEqual(400)
    expect(p.status).toBeLessThan(500)
    expect(p.body.access_token).toBeUndefined()
  })

  it('5.8 (3) / phase 0 (5): the app schema cannot be read through the Data API with the publishable key', async () => {
    const res = await fetch(`${url}/rest/v1/profiles?select=*&limit=1`, {
      headers: { apikey: key ?? '', 'Accept-Profile': 'app' },
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    // Either an error status, or 200 with no rows. A row means app.profiles is exposed: fail.
    if (res.status === 200) expect(JSON.parse(text)).toEqual([])
    else expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
