// 02 10 phase 2 completion (1) / (4), the IDOR cases of 02 9.2.2 and AZ-11 (07 13.3), as seen in the browser.
// Needs the dev DB with the seed users and WP-3.3: skipped unless E2E_DB=1, E2E_FOLDERS=1 and SEED_PASSWORD are set.
// NOT RUN in WP-3.5 (no DB connection, no browser start). Selectors follow e2e/folders.spec.ts; adjust on the first real run and record it in 10.
// Residue: the folder `e2e-<runId>-idor` is deleted by the last test; a failed run leaves it (see docs/runbook.md section 10).
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { SEED_USERS } from '../scripts/seed-lib'

const RUN = process.env.E2E_DB === '1' && process.env.E2E_FOLDERS === '1' && !!process.env.SEED_PASSWORD
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? ''
const folderName = `e2e-${randomBytes(4).toString('hex')}-idor`

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

/** The text of the page body, which must not depend on why the page is a 404. */
async function notFoundBody(page: Page, path: string): Promise<string> {
  const r = await page.goto(path)
  expect(r?.status(), path).toBe(404)
  return (await page.locator('body').innerText()).trim()
}

test.describe('folder IDOR and member removal (needs DB, seed and WP-3.3)', () => {
  test.skip(!RUN, 'set E2E_DB=1, E2E_FOLDERS=1 and SEED_PASSWORD to run')
  test.describe.configure({ mode: 'serial' })

  let folderUrl = ''

  test('setup: admin creates a folder and adds the member', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.getByRole('button', { name: 'フォルダ作成' }).click()
    await page.getByLabel('フォルダ名（必須）').fill(folderName)
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await expect(page).toHaveURL(/\/folders\/[0-9a-f-]{36}$/)
    folderUrl = new URL(page.url()).pathname
    await page.getByRole('link', { name: 'メンバー', exact: true }).click()
    await page.getByRole('button', { name: 'メンバー追加' }).click()
    await page.getByRole('dialog').getByText(MEMBER.email).click()
    await page.getByRole('dialog').getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('cell', { name: MEMBER.email })).toBeVisible()
  })

  test('phase 2 (4) removing the member takes effect at once: gone from the list, the URL is 404', async ({ browser }) => {
    const admin = await browser.newPage()
    const member = await browser.newPage()
    await signIn(member, MEMBER.email)
    await expect(member.getByRole('link', { name: folderName })).toBeVisible()
    expect((await member.goto(folderUrl))?.status()).toBe(200)

    await signIn(admin, ADMIN.email)
    await admin.goto(`${folderUrl}?tab=members`)
    await admin.getByRole('row', { name: new RegExp(MEMBER.email) }).getByRole('button', { name: '外す' }).click()
    await admin.getByRole('dialog').getByRole('button', { name: '外す', exact: true }).click()
    await expect(admin.getByRole('cell', { name: MEMBER.email })).toHaveCount(0)

    await member.goto('/folders')
    await expect(member.getByRole('link', { name: folderName })).toHaveCount(0)
    expect((await member.goto(folderUrl))?.status()).toBe(404)
    await admin.close()
    await member.close()
  })

  test('IDOR phase 2 (1): a folder the user may not see, an unknown uuid and a non-uuid id show the same 404 page', async ({ page }) => {
    await signIn(page, MEMBER.email)
    const removed = await notFoundBody(page, folderUrl)
    const unknown = await notFoundBody(page, `/folders/${randomUUID()}`)
    const malformed = await notFoundBody(page, '/folders/not-a-uuid')
    expect(unknown).toBe(removed)
    expect(malformed).toBe(removed)
    // The tab parameter must not turn a hidden folder into a different answer either.
    expect(await notFoundBody(page, `${folderUrl}?tab=members`)).toBe(removed)
  })

  test('AZ-11 a member gets a 404 on every /admin/* page', async ({ page }) => {
    await signIn(page, MEMBER.email)
    for (const p of ['/admin/folders', '/admin/invites']) expect((await page.goto(p))?.status(), p).toBe(404)
  })

  test('IDOR a deleted folder is a 404 for the admin as well; cleanup', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto('/admin/folders')
    await page.getByRole('row', { name: new RegExp(folderName) }).getByRole('button', { name: '削除' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill(folderName)
    await dialog.getByRole('button', { name: '削除', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('フォルダを削除しました')
    expect((await page.goto(folderUrl))?.status()).toBe(404)
  })
})
