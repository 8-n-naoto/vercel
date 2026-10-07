// S14 (08 5.14). Without a session the page redirects to /login (WP-1.3). S14-1 .. S14-4 need a logged-in user on a DB and live in
// e2e/phase2-flow.spec.ts (skipped unless E2E_DB=1 and SEED_PASSWORD are set).
import { expect, test } from '@playwright/test'

test('S14: no session -> /login with next=/account', async ({ page }) => {
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login\?next=/)
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain('/account')
})
