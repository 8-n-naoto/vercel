// S02 / S03 rendering (08 5.2 / 5.3) via react-dom/server. Submission paths need WP-2.3 and a DB and are not covered here.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { InviteInspect } from '@/lib/dto'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }))
vi.mock('@/app/_actions/auth', () => ({
  invitesAccept: () => Promise.resolve({ ok: true, data: null }),
  passwordResetComplete: () => Promise.resolve({ ok: true, data: null }),
}))

// A plain function, not vi.fn: with vi.fn the handled RATE_LIMITED rejection still failed the test in this setup (vitest 5.0.3).
let inspectImpl: () => Promise<InviteInspect> = () => Promise.resolve({ valid: false })
const inspect = {
  resolves: (v: InviteInspect) => { inspectImpl = () => Promise.resolve(v) },
  throws: (e: Error) => { inspectImpl = async () => { throw e } },
}
vi.mock('@/server/services/invites', () => ({ invitesService: { inspect: () => inspectImpl() } }))
vi.mock('@/server/page', () => ({
  pageContext: () => Promise.resolve({}),
  runPublicPage: async (_ctx: unknown, fn: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn() }
    } catch (e) {
      // duck-typed: the mock factory is hoisted above the AppError import, so instanceof is not reliable here
      const shape = (e as { shape?: { code?: string; retryAfterSec?: number } }).shape
      if (shape?.code === 'RATE_LIMITED') return { ok: false, rateLimited: { retryAfterSec: shape.retryAfterSec ?? 0 } }
      throw e
    }
  },
}))

import InvitePage from '@/app/(public)/invite/[token]/page'
import ResetPage from '@/app/(public)/reset/[token]/page'
import { InviteAcceptForm } from './invite-accept-form'
import { PasswordResetForm } from './password-reset-form'
import { checkPasswords, PASSWORD_MISMATCH, PASSWORD_NOTICE, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT } from './token-form-parts'

const TOKEN = 'A'.repeat(43)
const INVALID = 'この URL は無効か、期限が切れています。管理者に再発行を依頼してください'
const render = async (page: (p: { params: Promise<{ token: string }> }) => Promise<React.ReactElement>) =>
  renderToStaticMarkup(await page({ params: Promise.resolve({ token: TOKEN }) }))

describe('InviteAcceptForm (08 5.2)', () => {
  const html = renderToStaticMarkup(<InviteAcceptForm token={TOKEN} email="invitee@example.com" />)
  it('shows the heading, the read-only email, the labelled fields and the notice', () => {
    expect(html).toContain('>アカウント登録</h1>')
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>メールアドレス<\/label>/)
    expect(html).toMatch(/<input[^>]*id="email"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*id="email"/)
    expect(html).toContain('value="invitee@example.com"')
    expect(html).toMatch(/<label[^>]*for="displayName"[^>]*>表示名<\/label>/)
    expect(html).toContain('maxLength="50"')
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>パスワード<\/label>/)
    expect(html).toMatch(/<label[^>]*for="passwordConfirm"[^>]*>パスワード（確認）<\/label>/)
    expect(html).toContain(PASSWORD_NOTICE)
    expect(html).toContain('登録する')
    expect(html).toContain('type="submit"')
  })
  it('both password fields use autoComplete=new-password', () => {
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2)
  })
  it('shows no error before submission', () => {
    expect(html).not.toContain('role="alert"')
  })
})

describe('PasswordResetForm (08 5.3)', () => {
  const html = renderToStaticMarkup(<PasswordResetForm token={TOKEN} />)
  it('shows the heading, the labelled fields and the notice, and no email / display name', () => {
    expect(html).toContain('>パスワード再設定</h1>')
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>新しいパスワード<\/label>/)
    expect(html).toMatch(/<label[^>]*for="passwordConfirm"[^>]*>新しいパスワード（確認）<\/label>/)
    expect(html).toContain(PASSWORD_NOTICE)
    expect(html).toContain('変更する')
    expect(html).not.toContain('メールアドレス')
    expect(html).not.toContain('表示名')
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2)
  })
})

describe('checkPasswords (08 5.2 S02-3, 6.2)', () => {
  it('11 characters -> too short on the password field', () => {
    expect(checkPasswords('a'.repeat(11), 'a'.repeat(11))).toEqual({ password: PASSWORD_TOO_SHORT })
    expect(PASSWORD_TOO_SHORT).toBe('12 文字以上で入力してください')
  })
  it('mismatch -> message on the confirmation field', () => {
    expect(checkPasswords('a'.repeat(12), 'a'.repeat(13))).toEqual({ passwordConfirm: PASSWORD_MISMATCH })
    expect(PASSWORD_MISMATCH).toBe('パスワードが一致しません')
  })
  it('both errors are reported together; 12 and 72 pass; 73 fails', () => {
    expect(checkPasswords('short', 'other')).toEqual({ password: PASSWORD_TOO_SHORT, passwordConfirm: PASSWORD_MISMATCH })
    expect(checkPasswords('a'.repeat(12), 'a'.repeat(12))).toBeNull()
    expect(checkPasswords('a'.repeat(72), 'a'.repeat(72))).toBeNull()
    expect(checkPasswords('a'.repeat(73), 'a'.repeat(73))).toEqual({ password: PASSWORD_TOO_LONG })
  })
})

describe.each([
  ['S02 /invite/[token]', InvitePage, 'アカウント登録'],
  ['S03 /reset/[token]', ResetPage, 'パスワード再設定'],
])('%s page', (_name, page, heading) => {
  beforeEach(() => inspect.resolves({ valid: false }))

  it('valid -> the form (and the email on S02 only)', async () => {
    inspect.resolves({ valid: true, email: page === InvitePage ? 'invitee@example.com' : null })
    const html = await render(page)
    expect(html).toContain(`>${heading}</h1>`)
    expect(html.includes('invitee@example.com')).toBe(page === InvitePage)
    expect(html).not.toContain(INVALID)
  })
  it('invalid -> only the invalid-URL text, no form', async () => {
    inspect.resolves({ valid: false })
    const html = await render(page)
    expect(html).toContain(INVALID)
    expect(html).not.toContain('<form')
    expect(html).not.toContain(`>${heading}</h1>`)
  })
  it('rate limited -> the 429 screen, no form', async () => {
    inspect.throws(new AppError({ code: 'RATE_LIMITED', message: 'x', retryAfterSec: 120 }))
    const html = await render(page)
    expect(html).toContain('しばらく時間をおいてから再度お試しください')
    expect(html).toContain('2 分')
    expect(html).not.toContain('<form')
    expect(html).not.toContain(INVALID)
  })
})
