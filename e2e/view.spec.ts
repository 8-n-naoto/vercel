// S08 viewer (08 5.8, S08-1 .. S08-6). The unauthenticated redirect runs without a DB. The viewing flow needs the dev DB with the seed users,
// WP-4.x (upload), WP-5.1 (tickets) and WP-5.2 (/raw/[ticket] delivery on CONTENT_ORIGIN), so it is skipped unless
//   E2E_DB=1  and  SEED_PASSWORD is set, and E2E_VIEW=1 (set after WP-5.2 lands).
// NOT RUN in WP-5.3 (no DB / Supabase connection from the implementation environment). Selectors follow the components; adjust on the first real
// run and record it in 10. S08-6 (exactly one granted log row) is checked on the S05 access log tab, which arrives with WP-5.5: held as fixme.
// Residue: the tests create a folder named `e2e-<runId>-view`; the last test deletes it, but a failed run leaves it (see docs/runbook.md section 10).
import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { SEED_USERS } from '../scripts/seed-lib'

const RUN = process.env.E2E_DB === '1' && process.env.E2E_VIEW === '1' && !!process.env.SEED_PASSWORD
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? ''
const runId = randomBytes(4).toString('hex')
const folderName = `e2e-${runId}-view`
const fileTitle = `e2e-${runId}-probe`

const ADMIN = SEED_USERS.find((u) => u.role === 'admin')
const MEMBER = SEED_USERS.find((u) => u.role === 'user' && u.member)
if (!ADMIN || !MEMBER) throw new Error('SEED_USERS must contain an admin and a member')

const UUID_A = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'
const V01 = 'このページの内容は利用者がアップロードしたものです。パスワードや個人情報を入力しないでください。'

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL(/\/folders$/)
}

test.describe('unauthenticated (no DB needed)', () => {
  test('/view/<uuid> -> /login?next=', async ({ page }) => {
    await page.goto(`/view/${UUID_A}`)
    await expect(page).toHaveURL(/\/login\?next=/)
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain(`/view/${UUID_A}`)
  })
})

test.describe('viewer flow (needs DB, seed, WP-5.1 and WP-5.2)', () => {
  test.skip(!RUN, 'set E2E_DB=1, E2E_VIEW=1 and SEED_PASSWORD to run')
  test.describe.configure({ mode: 'serial' })

  let folderUrl = ''
  let viewUrl = ''

  test('setup: admin creates a folder, adds the member and uploads probe.html', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.getByRole('button', { name: 'フォルダ作成' }).click()
    await page.getByLabel('フォルダ名（必須）').fill(folderName)
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await expect(page).toHaveURL(/\/folders\/[0-9a-f-]{36}$/)
    folderUrl = page.url()
    await page.getByRole('link', { name: 'メンバー', exact: true }).click()
    await page.getByRole('button', { name: 'メンバー追加' }).click()
    await page.getByRole('dialog').getByText(MEMBER.email).click()
    await page.getByRole('dialog').getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByRole('cell', { name: MEMBER.email })).toBeVisible()

    await page.goto(`${folderUrl}/upload`)
    await page.getByLabel('アップロードするファイル').setInputFiles('e2e/assets/probe.html')
    await page.getByLabel('表示名').fill(fileTitle)
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await expect(page).toHaveURL(/\/folders\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\?uploaded=1$/, { timeout: 60_000 })
    const fileId = /\/files\/([0-9a-f-]{36})/.exec(page.url())?.[1]
    expect(fileId).toBeTruthy()
    viewUrl = `/view/${fileId}`
  })

  test('S08-1 a member sees the notice and an iframe whose src starts with CONTENT_ORIGIN/raw/ and sandbox is allow-scripts only', async ({ page }) => {
    await signIn(page, MEMBER.email)
    await page.goto(viewUrl)
    await expect(page.getByText(V01)).toBeVisible()
    const frame = page.locator('iframe')
    await expect(frame).toHaveCount(1)
    await expect(frame).toHaveAttribute('src', /^https?:\/\/[^/]+\/raw\/.+/)
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(new URL((await frame.getAttribute('src')) ?? '').origin).not.toBe(new URL(page.url()).origin)
    await expect(page.getByRole('button', { name: 'ダウンロード' })).toHaveCount(0) // download is off by default
  })

  test('S08-2 isolation: the script in the frame cannot read cookies, navigate top, submit a form or open a window', async ({ page }) => {
    await signIn(page, MEMBER.email)
    let popups = 0
    page.on('popup', () => {
      popups += 1
    })
    await page.goto(viewUrl)
    const inner = page.frameLocator('iframe')
    await expect(inner.locator('#probe-cookie')).toContainText(/empty|blocked/)
    await expect(inner.locator('#probe-cookie')).not.toContainText('READABLE')
    await expect(inner.locator('#probe-open')).toContainText('blocked')
    expect(popups).toBe(0)
    expect(new URL(page.url()).pathname).toBe(viewUrl) // top was not navigated by the frame
  })

  test('S08-3 suspended: the member sees 現在、公開が停止されています instead of the iframe', async ({ page, browser }) => {
    await signIn(page, ADMIN.email)
    await page.goto(folderUrl)
    await page.getByRole('row', { name: new RegExp(fileTitle) }).getByRole('link', { name: '詳細' }).click()
    await page.getByLabel('公開を停止する').check()
    await page.getByRole('button', { name: '保存' }).last().click()
    await expect(page.getByText('保存しました')).toBeVisible()

    const ctx = await browser.newContext()
    const memberPage = await ctx.newPage()
    await signIn(memberPage, MEMBER.email)
    const r = await memberPage.goto(viewUrl)
    expect(r?.status()).toBe(200)
    await expect(memberPage.getByText('現在、公開が停止されています')).toBeVisible()
    await expect(memberPage.locator('iframe')).toHaveCount(0)
    await expect(memberPage.getByRole('button', { name: 'ダウンロード' })).toHaveCount(0)
    await ctx.close()
  })

  test('S08-4 admin preview of the suspended file shows the banner and the content', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(viewUrl)
    await expect(
      page.getByText('管理者プレビュー: 閲覧制限を無視して表示しています（現在の状態: 公開停止）。メンバーには表示されません'),
    ).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(1)
  })

  test('S08-5 download: with download allowed the button saves a file; reload keeps one iframe', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(folderUrl)
    await page.getByRole('row', { name: new RegExp(fileTitle) }).getByRole('link', { name: '詳細' }).click()
    await page.getByLabel('公開を停止する').uncheck()
    await page.getByLabel('許可する').check()
    await page.getByRole('button', { name: '保存' }).last().click()
    await expect(page.getByText('保存しました')).toBeVisible()

    await page.goto(viewUrl)
    await expect(page.locator('iframe')).toHaveCount(1)
    const before = await page.locator('iframe').getAttribute('src')
    await page.getByRole('button', { name: '再読み込み' }).click()
    await expect(page.locator('iframe')).toHaveCount(1)
    await expect(page.locator('iframe')).not.toHaveAttribute('src', before ?? '')

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ダウンロード' }).click()])
    expect(download.suggestedFilename()).toBe('probe.html')
    expect(new URL(page.url()).pathname).toBe(viewUrl)
  })

  test.fixme('S08-6 one visit records exactly one granted row, and hovering [開く] records none (checked on the S05 log tab, WP-5.5)', async () => {
    // Implemented with WP-5.5 (access log tab).
  })

  test('cleanup: admin deletes the folder', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto('/admin/folders')
    const row = page.getByRole('row', { name: new RegExp(folderName) })
    await row.getByRole('button', { name: '削除' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill(folderName)
    await dialog.getByRole('button', { name: '削除', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(folderName) })).toHaveCount(0)
  })
})
