// S06 / S07 / S05 files tab (08 5.5 - 5.7). The unauthenticated redirects run without a DB. The click paths need the dev DB with the seed users and
// the WP-4.1 / WP-4.2 Actions, so they are skipped unless
//   E2E_DB=1  and  SEED_PASSWORD is set, and E2E_FILES=1 (set after WP-4.2 lands).
// NOT RUN in WP-4.4 (no DB / Supabase connection from the implementation environment). Selectors follow the components; adjust on the first real
// run and record it in 10. S07-3 (share link revoke) is held until WP-6.3 (the share link table does not exist yet).
// Residue: the tests create a folder named `e2e-<runId>-files`; the last test deletes it, but a failed run leaves it (see docs/runbook.md section 10).
import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { SEED_USERS } from '../scripts/seed-lib'
import { signIn } from './support/session'

const RUN = process.env.E2E_DB === '1' && process.env.E2E_FILES === '1' && !!process.env.SEED_PASSWORD
const runId = randomBytes(4).toString('hex')
const folderName = `e2e-${runId}-files`
const fileTitle = `e2e-${runId}-doc`

const ADMIN = SEED_USERS.find((u) => u.role === 'admin')
const MEMBER = SEED_USERS.find((u) => u.role === 'user' && u.member)
if (!ADMIN || !MEMBER) throw new Error('SEED_USERS must contain an admin and a member')

const UUID_A = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'
const UUID_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

/** About 1MB of UTF-8 HTML. */
function oneMbHtml(): Buffer {
  const head = '<!doctype html><html><head><meta charset="utf-8"><title>e2e</title></head><body>'
  const filler = '<p>あいうえお</p>\n'.repeat(Math.ceil((1024 * 1024) / Buffer.byteLength('<p>あいうえお</p>\n')))
  return Buffer.from(`${head}${filler}</body></html>`, 'utf-8')
}

// First bytes of a PNG: binary content with an .html name (S06-3).
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

test.describe('unauthenticated (no DB needed)', () => {
  for (const path of [`/folders/${UUID_A}/upload`, `/folders/${UUID_A}/files/${UUID_B}`]) {
    test(`${path} -> /login?next=`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login\?next=/)
      expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain(path)
    })
  }
})

test.describe('files flow (needs DB, seed and WP-4.1 / WP-4.2)', () => {
  test.skip(!RUN, 'set E2E_DB=1, E2E_FILES=1 and SEED_PASSWORD to run')
  test.describe.configure({ mode: 'serial' })

  let folderUrl = ''

  test('setup: admin creates a folder and adds the member', async ({ page }) => {
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
  })

  test('S06-2 a .txt file shows the extension message and keeps upload disabled; a file over the limit shows the size message', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.getByText('.html または .htm のファイルを選択してください')).toBeVisible()
    await expect(page.getByRole('button', { name: 'アップロード', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '選び直す' }).click()
    await page.getByLabel('アップロードするファイル').setInputFiles('e2e/assets/large-over-limit.html')
    await expect(page.getByText(/ファイルサイズが上限（\d+MB）を超えています/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'アップロード', exact: true })).toBeDisabled()
  })

  test('S06-3 a PNG named .html is rejected with the not-text message and the list does not grow', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'fake.html', mimeType: 'text/html', buffer: PNG_BYTES })
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('テキスト（HTML）ではないファイルです')
    await page.goto(folderUrl)
    await expect(page.getByText('fake')).toHaveCount(0)
  })

  test('S06-4 cancelling during the transfer shows the cancel message and the list does not grow', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    // Hold the PUT to the signed URL so that the transfer stays in progress until [キャンセル] is pressed.
    await page.route(/\/storage\/v1\/object\/upload\//, () => undefined)
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'slow.html', mimeType: 'text/html', buffer: oneMbHtml() })
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await page.getByRole('button', { name: 'キャンセル' }).click()
    await expect(page.getByText('アップロードを取り消しました')).toBeVisible()
    await page.goto(folderUrl)
    await expect(page.getByText('slow')).toHaveCount(0)
  })

  test('S06-1 a 1MB UTF-8 HTML uploads, S07 shows the uploaded notice, state 公開中 and download off', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'doc.html', mimeType: 'text/html', buffer: oneMbHtml() })
    await page.getByLabel('表示名').fill(fileTitle)
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await expect(page).toHaveURL(/\/folders\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\?uploaded=1$/, { timeout: 60_000 })
    await expect(page.getByText('アップロードしました。閲覧制限と公開リンクを確認してください')).toBeVisible()
    await expect(page.getByText('公開中').first()).toBeVisible()
    await expect(page.getByLabel('許可する')).not.toBeChecked()
  })

  test('S05-7 sorting by name puts sort=name_asc in the URL', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(folderUrl)
    await page.getByLabel('並べ替え').click()
    await page.getByRole('option', { name: '名前順' }).click()
    await expect(page).toHaveURL(/sort=name_asc/)
    await expect(page.getByRole('cell', { name: fileTitle })).toBeVisible()
  })

  test('S06-5 a member gets 404 on the upload page and the files tab has no 詳細 link (S05-2)', async ({ page }) => {
    await signIn(page, MEMBER.email)
    const r = await page.goto(`${folderUrl}/upload`)
    expect(r?.status()).toBe(404)
    await page.goto(folderUrl)
    await expect(page.getByRole('link', { name: '詳細' })).toHaveCount(0)
  })

  test('S07-2 an end date before the start date shows the message under the end field and does not save', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(folderUrl)
    await page.getByRole('row', { name: new RegExp(fileTitle) }).getByRole('link', { name: '詳細' }).click()
    await page.getByLabel('開始（日本時間）').fill('2030-01-02T09:00')
    await page.getByLabel('終了（日本時間）').fill('2030-01-01T09:00')
    await page.getByRole('button', { name: '保存' }).last().click()
    await expect(page.getByText('終了日時は開始日時より後にしてください')).toBeVisible()
    await expect(page.getByText('保存しました')).toHaveCount(0)
  })

  test('S07-1 suspending shows 保存しました and the badge 公開停止; the member no longer sees the file', async ({ page, browser }) => {
    await signIn(page, ADMIN.email)
    await page.goto(folderUrl)
    await page.getByRole('row', { name: new RegExp(fileTitle) }).getByRole('link', { name: '詳細' }).click()
    const detailUrl = page.url()
    await page.getByLabel('公開を停止する').check()
    await page.getByRole('button', { name: '保存' }).last().click()
    await expect(page.getByText('保存しました')).toBeVisible()
    await expect(page.getByText('公開停止').first()).toBeVisible()

    const ctx = await browser.newContext()
    const memberPage = await ctx.newPage()
    await signIn(memberPage, MEMBER.email)
    await memberPage.goto(folderUrl)
    await expect(memberPage.getByText(fileTitle)).toHaveCount(0)
    const r = await memberPage.goto(detailUrl)
    expect(r?.status()).toBe(404)
    await ctx.close()
  })

  test.fixme('S07-3 revoking a share link hides the row by default and shows 取り消し済み with the toggle (held until WP-6.3: the share link table)', async () => {
    // Implemented with WP-6.3 together with D03 / D04 and S07-4 / S07-5.
  })

  // ---- WP-4.7 (T-040): 02 10 phase 3 (1) / (2) browser layer and the abnormal kinds ----------------------------------------------
  const UPLOADED_URL = /\/folders\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\?uploaded=1$/

  test('P3-1 a 50MB HTML (exactly the limit, generated in the test) uploads and becomes active (S07 shows the uploaded notice and 公開中)', async ({ page }) => {
    test.setTimeout(300_000)
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    const head = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><title>max</title></head><body>', 'utf-8')
    const body = Buffer.alloc(50 * 1024 * 1024, 0x61)
    head.copy(body)
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'max50.html', mimeType: 'text/html', buffer: body })
    await expect(page.getByText(/ファイルサイズが上限/)).toHaveCount(0)
    await page.getByLabel('表示名').fill(`abn-${runId}-max`)
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await expect(page).toHaveURL(UPLOADED_URL, { timeout: 240_000 })
    await expect(page.getByText('公開中').first()).toBeVisible()
  })

  test('P3-2 browser layer: 50MB + 1 byte generated in the test is refused with the size message, and so is a .htm.exe name; the list does not grow', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'over.html', mimeType: 'text/html', buffer: Buffer.alloc(50 * 1024 * 1024 + 1, 0x61) })
    await expect(page.getByText(/ファイルサイズが上限（\d+MB）を超えています/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'アップロード', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '選び直す' }).click()
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'evil.htm.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('<p>x') })
    await expect(page.getByText('.html または .htm のファイルを選択してください')).toBeVisible()
    await expect(page.getByRole('button', { name: 'アップロード', exact: true })).toBeDisabled()
    await page.goto(folderUrl)
    await expect(page.getByText('over')).toHaveCount(0)
    await expect(page.getByText('evil')).toHaveCount(0)
  })

  test('P3-3 destructive HTML (probe.html) is accepted at upload; the S07 page is not navigated away, no dialog opens, and no popup is created (isolation is WP-5.5)', async ({ page }) => {
    await signIn(page, ADMIN.email)
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    let popups = 0
    page.on('popup', () => {
      popups += 1
    })
    await page.goto(`${folderUrl}/upload`)
    await page.getByLabel('アップロードするファイル').setInputFiles('e2e/assets/probe.html')
    await page.getByLabel('表示名').fill(`abn-${runId}-probe`)
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await expect(page).toHaveURL(UPLOADED_URL, { timeout: 60_000 })
    await expect(page.getByText('アップロードしました。閲覧制限と公開リンクを確認してください')).toBeVisible()
    expect(dialogs).toEqual([])
    expect(popups).toBe(0)
  })

  for (const [asset, label] of [
    ['charset-utf8-bom.html', 'UTF-8'],
    ['charset-shift_jis.html', 'Shift_JIS'],
    ['charset-euc-jp.html', 'EUC-JP'],
    ['charset-iso-2022-jp.html', 'ISO-2022-JP'],
  ] as const) {
    test(`P3-4 charset ${asset}: uploads and S07 shows the estimated charset ${label}`, async ({ page }) => {
      await signIn(page, ADMIN.email)
      await page.goto(`${folderUrl}/upload`)
      await page.getByLabel('アップロードするファイル').setInputFiles(`e2e/assets/${asset}`)
      await page.getByLabel('表示名').fill(`abn-${runId}-${label}`)
      await page.getByRole('button', { name: 'アップロード', exact: true }).click()
      await expect(page).toHaveURL(UPLOADED_URL, { timeout: 60_000 })
      await expect(page.getByLabel('文字コード')).toContainText(label)
    })
  }

  test('P3-5 a UTF-16 file named .html is rejected with the not-text message and the list does not grow', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(`${folderUrl}/upload`)
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>utf16</p>', 'utf16le')])
    await page.getByLabel('アップロードするファイル').setInputFiles({ name: 'utf16.html', mimeType: 'text/html', buffer: utf16 })
    await page.getByRole('button', { name: 'アップロード', exact: true }).click()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('テキスト（HTML）ではないファイルです')
    await page.goto(folderUrl)
    await expect(page.getByText('utf16')).toHaveCount(0)
  })

  test('S07-7 deleting the file returns to S05 and the file is gone', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto(folderUrl)
    await page.getByRole('row', { name: new RegExp(fileTitle) }).getByRole('link', { name: '詳細' }).click()
    await page.getByRole('button', { name: '削除', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '削除する' }).click()
    await expect(page).toHaveURL(/\/folders\/[0-9a-f-]{36}$/)
    await expect(page.getByText(fileTitle)).toHaveCount(0)
  })

  test('cleanup: admin deletes the folder', async ({ page }) => {
    await signIn(page, ADMIN.email)
    await page.goto('/admin/folders')
    const row = page.getByRole('row', { name: new RegExp(folderName) })
    await row.getByRole('button', { name: '削除' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill(folderName)
    await dialog.getByRole('button', { name: '削除する', exact: true }).click()
    await expect(page.getByRole('row', { name: new RegExp(folderName) })).toHaveCount(0)
  })
})
