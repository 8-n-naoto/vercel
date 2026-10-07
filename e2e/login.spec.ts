// S01 smoke (08 5.1): rendering and next handling only. Sign-in itself needs WP-2.1 and a DB (S01-1/2/4/5 unverified).
import { expect, test } from '@playwright/test'

test('S01 renders without sign-up or forgot-password links', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible()
  await expect(page.getByLabel('メールアドレス')).toHaveAttribute('autocomplete', 'username')
  await expect(page.getByLabel('パスワード')).toHaveAttribute('autocomplete', 'current-password')
  await expect(page.getByText('※ アカウントは招待制です。パスワードを忘れた場合は管理者に連絡してください。')).toBeVisible()
  await expect(page.locator('main a')).toHaveCount(0)
})

test('S01-3: next is kept only for a relative path', async ({ page }) => {
  const nextValue = async (url: string) => {
    await page.goto(url)
    return page.locator('input[name="next"]').inputValue()
  }
  expect(await nextValue('/login?next=/admin/users')).toBe('/admin/users')
  expect(await nextValue('/login?next=//evil.example')).toBe('')
  expect(await nextValue('/login?next=https://evil.example')).toBe('')
})

test('S01-M1 appears for reset=1 only', async ({ page }) => {
  await page.goto('/login?reset=1')
  await expect(page.getByText('パスワードを変更しました。新しいパスワードでログインしてください')).toBeVisible()
  await page.goto('/login')
  await expect(page.getByText('パスワードを変更しました')).toHaveCount(0)
})
