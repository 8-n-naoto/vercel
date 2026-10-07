// S04 / S05 / S12 / D01 / D02 (08 5.4 / 5.5 / 5.12 / 4.6 / 4.7). The unauthenticated redirects run without a DB. The click paths need the
// dev DB with the seed users and the WP-3.3 Actions (they are stubs in WP-3.4), so they are skipped unless
//   E2E_DB=1  and  SEED_PASSWORD is set, and E2E_FOLDERS=1 (set after WP-3.3 lands).
// NOT RUN in WP-3.4 (no DB connection). Selectors follow the components; adjust on the first real run and record it in 10.
// Residue: the tests create folders named `e2e-<runId>-*`; the tests delete them, but a failed run leaves them (see docs/runbook.md section 10).
import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { SEED_USERS } from '../scripts/seed-lib'

const RUN = process.env.E2E_DB === '1' && process.env.E2E_FOLDERS === '1' && !!process.env.SEED_PASSWORD
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? ''
const runId = randomBytes(4).toString('hex')
const folderName = `e2e-${runId}-a`

const ADMIN = SEED_USERS.find((u) => u.role === 'admin')
const MEMBER = SEED_USERS.find((u) => u.role === 'user' && u.member)
if (!ADMIN || !MEMBER) throw new Error('SEED_USERS must contain an admin and a member')

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL(/\/folders$/)
}

test.describe('unauthenticated (no DB needed)', () => {
  for (const path of ['/folders', '/folders/3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60', '/admin/folders']) {
    test(`${path} -> /login?next=`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login\?next=/)
      expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain(path)
    })
  }
})

test.describe('folders flow (needs DB, seed and WP-3.3)', () => {
  test.skip(!RUN, 'set E2E_DB=1, E2E_FOLDERS=1 and SEED_PASSWORD to run')
  test.describe.configure({ mode: 'serial' })

  test('D01-1 / D01-2 admin creates a folder: empty name shows an error, then a valid name opens S05', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.getByRole('button', { name: 'フォルダ作成' }).click()
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    await page.getByLabel('フォルダ名（必須）').fill(folderName)
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await expect(page).toHaveURL(/\/folders\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: folderName })).toBeVisible()
  })

  test('S04-1 / S04-3 admin sees the folder in the list', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await expect(page.getByRole('link', { name: folderName })).toBeVisible()
  })

  test('S05-1 admin sees four tabs; D02 adds a member and the members tab lists them', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.getByRole('link', { name: folderName }).click()
    for (const t of ['ファイル', 'メンバー', '閲覧ログ', '設定']) await expect(page.getByRole('link', { name: t })).toBeVisible()
    await page.getByRole('link', { name: 'メンバー', exact: true }).click()
    await page.getByRole('button', { name: 'メンバー追加' }).click()
    await page.getByRole('dialog').getByText(MEMBER.email).click()
    await page.getByRole('dialog').getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('cell', { name: MEMBER.email })).toBeVisible()
  })

  test('S05-1 / S05-4 the member sees two tabs and display names only; settings falls back to files', async ({ page }) => {
    await signIn(page, MEMBER.email)
    await page.getByRole('link', { name: folderName }).click()
    await expect(page.getByRole('link', { name: '閲覧ログ' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '設定', exact: true })).toHaveCount(0)
    const url = page.url()
    await page.goto(`${url}?tab=settings`)
    await expect(page.getByRole('link', { name: 'ファイル' })).toHaveAttribute('aria-current', 'page')
    await page.goto(`${url}?tab=members`)
    await expect(page.getByText(MEMBER.email)).toHaveCount(0)
  })

  test('S05-6 admin filters the logs tab by result=denied; the URL carries it and no full token is shown', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.getByRole('link', { name: folderName }).click()
    await page.getByRole('link', { name: '閲覧ログ' }).click()
    await page.getByLabel('結果').selectOption('denied')
    await page.getByRole('button', { name: '絞り込む' }).click()
    await expect(page).toHaveURL(/result=denied/)
    // Needs access-log rows (made by viewing as a member / via a link); with none the empty state is the expected result.
    const rows = page.getByRole('row')
    if ((await rows.count()) > 1) {
      for (const cell of await page.getByRole('cell', { name: /^(許可|拒否)$/ }).allTextContents()) expect(cell).toBe('拒否')
    } else {
      await expect(page.getByText('この条件の閲覧ログはありません')).toBeVisible()
    }
    // A share link viewer is shown as "label（…xxxx）"; a run of 32+ token characters must never appear.
    expect(await page.locator('table').allTextContents().then((t) => t.join(' '))).not.toMatch(/[A-Za-z0-9_-]{32,}/)
  })

  test('S05-3 an unknown or non-uuid folder id is a 404', async ({ page }) => {
    await signIn(page, MEMBER.email)
    const r = await page.goto('/folders/abc')
    expect(r?.status()).toBe(404)
  })

  test('S12-3 a member opening /admin/folders gets a 404', async ({ page }) => {
    await signIn(page, MEMBER.email)
    const r = await page.goto('/admin/folders')
    expect(r?.status()).toBe(404)
  })

  test('S12-1 / S12-2 admin deletes the folder by typing its name (D05) and sees the result', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto('/admin/folders')
    const row = page.getByRole('row', { name: new RegExp(folderName) })
    await row.getByRole('button', { name: '削除' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '削除', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox').fill(folderName)
    await dialog.getByRole('button', { name: '削除', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('フォルダを削除しました')
    await expect(page.getByRole('row', { name: new RegExp(folderName) })).toHaveCount(0)
  })
})
