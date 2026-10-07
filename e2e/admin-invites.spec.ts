// S10 (08 5.10). Without an admin session the page redirects to /login (WP-1.3). S10-1 .. S10-4 need the real Actions (WP-2.3) and
// an admin session on a DB, so they are skipped until then.
import { expect, test } from '@playwright/test'

test('S10: no session -> /login with next=/admin/invites', async ({ page }) => {
  await page.goto('/admin/invites')
  await expect(page).toHaveURL(/\/login\?next=/)
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain('/admin/invites')
})

for (const id of ['S10-1', 'S10-2', 'S10-3', 'S10-4']) {
  test.skip(`${id}: needs adminCreateInvite / adminRevokeInvite (WP-2.3) and an admin session`, () => undefined)
}
