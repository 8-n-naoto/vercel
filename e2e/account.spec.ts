// S14 (08 5.14). Without a session the page redirects to /login (WP-1.3). S14-1 .. S14-4 need a logged-in user on a DB (the Actions are
// implemented in WP-2.5), so they are skipped until the DB connection is available.
import { expect, test } from '@playwright/test'

test('S14: no session -> /login with next=/account', async ({ page }) => {
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login\?next=/)
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain('/account')
})

for (const id of ['S14-1', 'S14-2', 'S14-3', 'S14-4']) {
  test.skip(`${id}: needs a logged-in user on a DB`, () => undefined)
}
