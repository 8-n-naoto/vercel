// S02 / S03 smoke (08 5.2 / 5.3): the invalid-URL screen only. The dummy token never exists. The success paths need WP-2.3 and a DB
// (S02-1, S02-3 submit, S02-4, S03-1, S03-3 unverified).
import { expect, test } from '@playwright/test'

const DUMMY = 'A'.repeat(43)
const INVALID = 'この URL は無効か、期限が切れています。管理者に再発行を依頼してください'

for (const [id, path] of [
  ['S02-2', `/invite/${DUMMY}`],
  ['S03-2', `/reset/${DUMMY}`],
  ['S02-2 (bad format)', '/invite/short'],
  ['S03-2 (bad format)', '/reset/short'],
] as const) {
  test(`${id}: an invalid URL shows only the invalid text with HTTP 200`, async ({ page }) => {
    const res = await page.goto(path)
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: INVALID })).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)
    await expect(page.locator('input')).toHaveCount(0)
  })
}
