// e2e/support/session.ts
// Re-uses the sessions that e2e/auth.setup.ts saved (one login per role per run). login:email allows 5 attempts / 15 minutes and counts
// successful logins too (06 3.5), so specs must not log in again for every test.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { SEED_USERS } from '../../scripts/seed-lib'

export const AUTH_DIR = path.join(__dirname, '..', '.auth')

export function stateFileOf(email: string): string {
  const u = SEED_USERS.find((s) => s.email === email)
  if (!u) throw new Error(`no saved session for ${email}`)
  return path.join(AUTH_DIR, u.role === 'admin' ? 'admin.json' : u.member ? 'member.json' : 'outsider.json')
}

interface SavedCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

/** Puts the saved cookies of `email` into the page's browser context and opens /folders. Works for contexts made with browser.newContext() too. */
export async function signIn(page: Page, email: string): Promise<void> {
  const state = JSON.parse(readFileSync(stateFileOf(email), 'utf-8')) as { cookies: SavedCookie[] }
  await page.context().addCookies(state.cookies)
  await page.goto('/folders')
  await expect(page).toHaveURL(/\/folders$/)
}
