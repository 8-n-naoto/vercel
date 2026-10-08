// Phase 2 (authentication / invitation) end-to-end flow: 02 10 phase 1 conditions (1)(2)(4)(5), 08 S01-1/2/3/4/5, S02-1/3/4, S10-1/2/3/4.
// Needs a running app on a dev / test Supabase project with the seed users (npm run seed) and a logged-in flow, so it is skipped unless
//   E2E_DB=1  and  SEED_PASSWORD is set (the same value the seed used; it is read from the environment and never printed).
// NOT RUN in WP-2.7 (no DB connection yet). Selectors follow the components; adjust on the first real run and record it in 10.
// Residue: S02-1 creates an Auth user + profile and S10-* create invites for `e2e+<runId>-n@example.com`. They are NOT removed by
// npm run seed:cleanup; see docs/runbook.md section 10 (cleanup of E2E data) and the open request for an e2e:cleanup script.
import { randomBytes } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { SEED_USERS } from '../scripts/seed-lib'
import { signIn as restoreSession } from './support/session'

const RUN = process.env.E2E_DB === '1' && !!process.env.SEED_PASSWORD
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? ''
const runId = randomBytes(4).toString('hex')
const emailOf = (n: number): string => `e2e+${runId}-${n}@example.com`
const invitee1: { email: string; password: string } = { email: '', password: '' } // filled by the S02-1 test (serial), used by S14-3

const ADMIN = SEED_USERS.find((u) => u.role === 'admin')
const MEMBER = SEED_USERS.find((u) => u.role === 'user' && u.member)
if (!ADMIN || !MEMBER) throw new Error('SEED_USERS must contain an admin and a member')

const INVALID = 'この URL は無効か、期限が切れています。管理者に再発行を依頼してください'
const BAD_CREDENTIALS = 'メールアドレスまたはパスワードが違います'
const RATE_LIMITED = 'しばらく時間をおいてから再度お試しください'

async function signIn(page: Page, email: string, password: string, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'ログイン' }).click()
}

async function freshPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  // Each anonymous context gets its own documentation-range IPv6 address so that token:ip (10 / 15 min per address) is not used up by one run.
  // The local server honours x-forwarded-for (on Vercel it is overwritten, so only the local run is affected).
  const h = randomBytes(4).toString('hex')
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${h.slice(0, 4)}:${h.slice(4)}::1` } })
  return { ctx, page: await ctx.newPage() }
}

/** Issues an invite on S10 and returns the one-time URL shown in D04. */
async function issueInvite(page: Page, email: string): Promise<string> {
  await page.goto('/admin/invites')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByRole('button', { name: '招待 URL を発行' }).click()
  const url = await page.locator('#one-time-url').inputValue()
  await page.getByRole('button', { name: '閉じる' }).click()
  return url
}

test.describe('Phase 2 flow (needs DB and seed)', () => {
  test.skip(!RUN, 'set E2E_DB=1 and SEED_PASSWORD (dev DB + npm run seed) to run')
  test.describe.configure({ mode: 'serial' })

  // S01-1 login itself is exercised by e2e/auth.setup.ts (one login per role); here the saved session must land on /folders.
  test('S01-1 member signs in and lands on /folders with the display name in the header', async ({ page }) => {
    await restoreSession(page, MEMBER.email)
    await expect(page).toHaveURL(/\/folders$/)
    await expect(page.getByText(MEMBER.displayName).first()).toBeVisible()
  })

  test('S01-1 admin signing in from /login?next=/admin/invites lands on /admin/invites', async ({ page }) => {
    await signIn(page, ADMIN.email, SEED_PASSWORD, '/admin/invites')
    await expect(page).toHaveURL(/\/admin\/invites$/)
  })

  test('S01-2 wrong password and unknown e-mail show the same text', async ({ page }) => {
    const texts: string[] = []
    for (const [email, password] of [
      [MEMBER.email, 'definitely-wrong-password'],
      [`e2e-unknown-${runId}@example.com`, 'definitely-wrong-password'],
    ] as const) {
      await signIn(page, email, password)
      const alert = page.getByText(BAD_CREDENTIALS)
      await expect(alert).toBeVisible()
      texts.push((await alert.first().innerText()).trim())
    }
    expect(texts[0]).toBe(texts[1])
    await expect(page).toHaveURL(/\/login/)
  })

  test('S01-3 next=//evil.example and next=https://evil.example end on /folders', async ({ page }) => {
    for (const next of ['//evil.example', 'https://evil.example']) {
      await signIn(page, MEMBER.email, SEED_PASSWORD, next)
      await expect(page).toHaveURL(/\/folders$/)
      await page.context().clearCookies()
    }
  })

  test('S01-5 an already signed-in user opening /login is sent to /folders', async ({ page }) => {
    await restoreSession(page, MEMBER.email)
    await expect(page).toHaveURL(/\/folders$/)
    await page.goto('/login')
    await expect(page).toHaveURL(/\/folders$/)
  })

  test('phase 1 (5) the auth cookie is HttpOnly, SameSite=Lax, host-only (no Domain), Secure on https, and not readable from script', async ({ page, baseURL }) => {
    await restoreSession(page, MEMBER.email)
    await expect(page).toHaveURL(/\/folders$/)
    const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
    expect(cookies.length).toBeGreaterThan(0)
    const https = (baseURL ?? '').startsWith('https://')
    for (const c of cookies) {
      expect(c.httpOnly, `${c.name} httpOnly`).toBe(true)
      expect(c.sameSite, `${c.name} sameSite`).toBe('Lax')
      expect(c.domain.startsWith('.'), `${c.name} must be host-only (no Domain attribute)`).toBe(false)
      expect(c.secure, `${c.name} secure`).toBe(https)
      // capped at SESSION_MAX_AGE_DAYS (7) plus a minute of slack
      expect(c.expires === -1 || c.expires <= Date.now() / 1000 + 7 * 86_400 + 60).toBe(true)
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain('auth-token')
  })

  test('S01-4 six failures with one e-mail: the sixth shows the rate-limit text (a throw-away e-mail, so the seed users are not locked)', async ({ browser }) => {
    // The IP counter is shared by everything behind one address; on a local server x-forwarded-for is honoured, on Vercel it is overwritten.
    const ip = `2001:db8::${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}`
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } })
    const page = await ctx.newPage()
    const email = `e2e-ratelimit-${runId}@example.com`
    for (let i = 1; i <= 5; i++) {
      await signIn(page, email, 'definitely-wrong-password')
      await expect(page.getByText(BAD_CREDENTIALS)).toBeVisible()
    }
    await signIn(page, email, 'definitely-wrong-password')
    await expect(page.getByText(RATE_LIMITED)).toBeVisible()
    await ctx.close()
  })

  test('S10-1 / S02-1 / S02-4 / phase 1 (1) an invite URL registers once; the same URL is then invalid', async ({ page, browser }) => {
    await restoreSession(page, ADMIN.email)
    const email = emailOf(1)
    const url = await issueInvite(page, email)
    expect(url).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
    await expect(page.getByRole('row').filter({ hasText: email }).first()).toContainText('未使用')

    const invitee = await freshPage(browser)
    await invitee.page.goto(url)
    await expect(invitee.page.getByLabel('メールアドレス')).toHaveValue(email)
    await invitee.page.getByLabel('表示名').fill('E2E Invitee')
    const password = `${randomBytes(12).toString('base64url')}-Aa1`
    invitee1.email = email
    invitee1.password = password
    await invitee.page.getByLabel('パスワード', { exact: true }).fill(password)
    await invitee.page.getByLabel('パスワード（確認）').fill(password)
    await invitee.page.getByRole('button', { name: '登録する' }).click()
    await expect(invitee.page).toHaveURL(/\/folders$/)

    const again = await freshPage(browser)
    const res = await again.page.goto(url)
    expect(res?.status()).toBe(200)
    await expect(again.page.getByRole('heading', { name: INVALID })).toBeVisible()
    await expect(again.page.locator('form')).toHaveCount(0)
    await invitee.ctx.close()
    await again.ctx.close()
  })

  test('S02-3 a mismatching confirmation and an 11-character password are rejected without registering', async ({ page, browser }) => {
    await restoreSession(page, ADMIN.email)
    const url = await issueInvite(page, emailOf(2))
    const invitee = await freshPage(browser)
    await invitee.page.goto(url)
    await invitee.page.getByLabel('表示名').fill('E2E Invitee')
    await invitee.page.getByLabel('パスワード', { exact: true }).fill('aaaaaaaaaaaa')
    await invitee.page.getByLabel('パスワード（確認）').fill('bbbbbbbbbbbb')
    await invitee.page.getByRole('button', { name: '登録する' }).click()
    await expect(invitee.page.getByText('パスワードが一致しません')).toBeVisible()
    await invitee.page.getByLabel('パスワード', { exact: true }).fill('aaaaaaaaaaa')
    await invitee.page.getByLabel('パスワード（確認）').fill('aaaaaaaaaaa')
    await invitee.page.getByRole('button', { name: '登録する' }).click()
    await expect(invitee.page.getByText('12 文字以上で入力してください')).toBeVisible()
    await expect(invitee.page).toHaveURL(/\/invite\//)
    await invitee.ctx.close()
  })

  test('S10-2 an already registered e-mail is refused and no URL is shown', async ({ page }) => {
    await restoreSession(page, ADMIN.email)
    await page.goto('/admin/invites')
    await page.getByLabel('メールアドレス').fill(MEMBER.email)
    await page.getByRole('button', { name: '招待 URL を発行' }).click()
    await expect(page.getByText('このメールアドレスのユーザーは既に登録されています')).toBeVisible()
    await expect(page.locator('#one-time-url')).toHaveCount(0)
  })

  test('S10-3 / phase 1 (2) issuing twice revokes the first URL', async ({ page, browser }) => {
    await restoreSession(page, ADMIN.email)
    const email = emailOf(3)
    const first = await issueInvite(page, email)
    const second = await issueInvite(page, email)
    expect(second).not.toBe(first)
    const anon = await freshPage(browser)
    await anon.page.goto(first)
    await expect(anon.page.getByRole('heading', { name: INVALID })).toBeVisible()
    await anon.page.goto(second)
    await expect(anon.page.getByLabel('メールアドレス')).toHaveValue(email)
    await anon.ctx.close()
    await page.goto('/admin/invites')
    await expect(page.getByRole('row').filter({ hasText: email }).filter({ hasText: '取り消し済み' })).toHaveCount(1)
  })

  test('S10-4 / phase 1 (2) [取り消し] marks the invite revoked and its URL becomes invalid', async ({ page, browser }) => {
    await restoreSession(page, ADMIN.email)
    const email = emailOf(4)
    const url = await issueInvite(page, email)
    await page.reload()
    const row = page.getByRole('row').filter({ hasText: email })
    await row.getByRole('button', { name: '取り消し' }).click()
    await page.getByRole('button', { name: '取り消す' }).click()
    await expect(page.getByRole('row').filter({ hasText: email }).first()).toContainText('取り消し済み')
    const anon = await freshPage(browser)
    await anon.page.goto(url)
    await expect(anon.page.getByRole('heading', { name: INVALID })).toBeVisible()
    await anon.ctx.close()
  })

  test('phase 1 (2) a member cannot open /admin/invites (404 screen, no invite form)', async ({ page }) => {
    await restoreSession(page, MEMBER.email)
    const res = await page.goto('/admin/invites')
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('button', { name: '招待 URL を発行' })).toHaveCount(0)
  })

  test('S14-1 the display name can be changed and is shown in the header; restored afterwards', async ({ page }) => {
    await restoreSession(page, MEMBER.email)
    await page.goto('/account')
    const renamed = `${MEMBER.displayName} ${runId}`
    await page.getByLabel('表示名').fill(renamed)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('保存しました')).toBeVisible()
    await expect(page.getByText(renamed).first()).toBeVisible()
    await page.getByLabel('表示名').fill(MEMBER.displayName)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('保存しました')).toBeVisible()
  })

  test('S14-2 / S14-4 a wrong current password and an unchanged password are refused under the field', async ({ page }) => {
    await restoreSession(page, MEMBER.email)
    await page.goto('/account')
    await page.getByLabel('現在のパスワード', { exact: true }).fill('definitely-wrong-password')
    await page.getByLabel('新しいパスワード', { exact: true }).fill(`${runId}-new-Passw0rd`)
    await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(`${runId}-new-Passw0rd`)
    await page.getByRole('button', { name: 'パスワードを変更' }).click()
    await expect(page.locator('#currentPassword-error')).toHaveText('現在のパスワードが違います')
    await page.getByLabel('現在のパスワード', { exact: true }).fill(SEED_PASSWORD)
    await page.getByLabel('新しいパスワード', { exact: true }).fill(SEED_PASSWORD)
    await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(SEED_PASSWORD)
    await page.getByRole('button', { name: 'パスワードを変更' }).click()
    await expect(page.getByText('現在と異なるパスワードを指定してください')).toBeVisible()
  })

  test('S14-3 changing the password goes to /login with the notice, signs the old session out, and only the new password works (uses the user created by S02-1)', async ({ page, browser }) => {
    test.skip(invitee1.email === '', 'the S02-1 test did not run')
    const other = await freshPage(browser)
    await signIn(other.page, invitee1.email, invitee1.password)
    await expect(other.page).toHaveURL(/\/folders$/)

    await signIn(page, invitee1.email, invitee1.password)
    await expect(page).toHaveURL(/\/folders$/)
    await page.goto('/account')
    const next = `${randomBytes(12).toString('base64url')}-Bb2`
    await page.getByLabel('現在のパスワード', { exact: true }).fill(invitee1.password)
    await page.getByLabel('新しいパスワード', { exact: true }).fill(next)
    await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(next)
    await page.getByRole('button', { name: 'パスワードを変更' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('パスワードを変更しました。新しいパスワードでログインしてください')).toBeVisible()

    // phase 1 (6): the other browser's old session is sent to /login on its next navigation
    await other.page.goto('/folders')
    await expect(other.page).toHaveURL(/\/login/)
    await other.ctx.close()

    await signIn(page, invitee1.email, invitee1.password)
    await expect(page.getByText(BAD_CREDENTIALS)).toBeVisible()
    await signIn(page, invitee1.email, next)
    await expect(page).toHaveURL(/\/folders$/)
  })
})
