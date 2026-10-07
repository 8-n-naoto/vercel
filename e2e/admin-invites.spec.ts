// S10 (08 5.10). Without an admin session the page redirects to /login (WP-1.3). S10-1 .. S10-4 need an admin session on a DB and live in
// e2e/phase2-flow.spec.ts (skipped unless E2E_DB=1 and SEED_PASSWORD are set).
import { expect, test } from '@playwright/test'

test('S10: no session -> /login with next=/admin/invites', async ({ page }) => {
  await page.goto('/admin/invites')
  await expect(page).toHaveURL(/\/login\?next=/)
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain('/admin/invites')
})
