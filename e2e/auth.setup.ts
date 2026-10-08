// e2e/auth.setup.ts
// Setup project (playwright.config.ts): logs in once per role and saves the cookies to e2e/.auth/ (git-ignored).
// Login budget per run for the same e-mail (login:email = 5 / 15 min, successes count): the setup uses 1; specs add at most 3 (see runbook 10).
// Without E2E_DB=1 and SEED_PASSWORD nothing is saved and the DB-backed specs skip themselves.
import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { SEED_USERS } from '../scripts/seed-lib'
import { AUTH_DIR, stateFileOf } from './support/session'

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? ''

test.describe('save sessions', () => {
  test.skip(process.env.E2E_DB !== '1' || !SEED_PASSWORD, 'set E2E_DB=1 and SEED_PASSWORD to log in')
  mkdirSync(AUTH_DIR, { recursive: true })
  for (const user of SEED_USERS) {
    test(`login as ${user.role}${user.member ? ' (member)' : ''}: ${user.email} (S01-1)`, async ({ page }) => {
      await page.goto('/login')
      await page.getByLabel('メールアドレス').fill(user.email)
      await page.getByLabel('パスワード').fill(SEED_PASSWORD)
      await page.getByRole('button', { name: 'ログイン' }).click()
      await expect(page).toHaveURL(/\/folders$/)
      await expect(page.getByText(user.displayName).first()).toBeVisible()
      await page.context().storageState({ path: stateFileOf(user.email) })
    })
  }
})
