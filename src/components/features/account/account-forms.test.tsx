// S14 rendering and branches (08 5.14) via react-dom/server. There is no DOM in this setup, so each branch is driven by the props of the
// pure views; the click path (useActionForm -> Action) is covered by E2E once a DB and a login are available.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AppErrorShape } from '@/lib/errors'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))
vi.mock('@/app/_actions/account', () => ({
  accountUpdateProfile: () => Promise.resolve({ ok: true, data: null }),
  accountChangePassword: () => Promise.resolve({ ok: true, data: null }),
}))

import { ChangePasswordFormView, checkChangePassword, PASSWORD_CHANGE_NOTE } from './change-password-form'
import { ProfileFormView, PROFILE_SAVED_TEXT } from './profile-form'

const none = () => undefined
const noField = () => undefined
const failed = (fieldErrors: Record<string, string[]>): { ok: false; error: AppErrorShape } => ({
  ok: false,
  error: { code: 'VALIDATION_FAILED', message: '入力内容を確認してください', fieldErrors },
})
const profileProps = { email: 'me@example.com', role: 'user', displayName: '山田', state: null, pending: false, onSubmit: none, fieldError: noField } as const
const passwordProps = { state: null, pending: false, onSubmit: none, fieldError: noField } as const

describe('ProfileFormView (08 5.14)', () => {
  it('shows the read-only email, the role label and the display name with the save button', () => {
    const html = renderToStaticMarkup(<ProfileFormView {...profileProps} />)
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>メールアドレス<\/label>/)
    expect(html).toContain('value="me@example.com"')
    expect(html).toContain('readOnly=""')
    expect(html).toContain('一般ユーザー')
    expect(html).toMatch(/<label[^>]*for="displayName"[^>]*>表示名<\/label>/)
    expect(html).toContain('value="山田"')
    expect(html).toContain('maxLength="50"')
    expect(html).toContain('>保存<')
    expect(html).not.toContain(PROFILE_SAVED_TEXT)
  })
  it('shows the admin role label', () => {
    expect(renderToStaticMarkup(<ProfileFormView {...profileProps} role="admin" />)).toContain('管理者')
  })
  it('shows 保存しました after a successful save and keeps the saved value (S14-1)', () => {
    const html = renderToStaticMarkup(<ProfileFormView {...profileProps} displayName="新しい名前" state={{ ok: true, data: null }} />)
    expect(html).toContain('保存しました')
    expect(html).toContain('value="新しい名前"')
  })
  it('shows a field error under the display name and keeps the input value', () => {
    const html = renderToStaticMarkup(
      <ProfileFormView {...profileProps} displayName="" state={failed({ displayName: ['入力してください'] })} fieldError={(n) => (n === 'displayName' ? '入力してください' : undefined)} />,
    )
    expect(html).toContain('id="displayName-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).not.toContain('保存しました')
  })
  it('disables the button while pending', () => {
    expect(renderToStaticMarkup(<ProfileFormView {...profileProps} pending />)).toMatch(/<button[^>]*disabled=""[^>]*>処理中…/)
  })
})

describe('ChangePasswordFormView (08 5.14)', () => {
  const html = renderToStaticMarkup(<ChangePasswordFormView {...passwordProps} />)
  it('has the three labelled password fields with the right autoComplete, the notice and the button', () => {
    expect(html).toMatch(/<label[^>]*for="currentPassword"[^>]*>現在のパスワード<\/label>/)
    expect(html).toMatch(/<label[^>]*for="newPassword"[^>]*>新しいパスワード<\/label>/)
    expect(html).toMatch(/<label[^>]*for="newPasswordConfirm"[^>]*>新しいパスワード（確認）<\/label>/)
    expect(html).toMatch(/<input[^>]*id="currentPassword"[^>]*autoComplete="current-password"|<input[^>]*autoComplete="current-password"[^>]*id="currentPassword"/)
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2)
    expect(html).toContain(PASSWORD_CHANGE_NOTE)
    expect(PASSWORD_CHANGE_NOTE).toBe('変更すると、すべての端末でログアウトされます')
    expect(html).toContain('パスワードを変更</button>')
  })
  it('shows account.current_password_invalid under the current password field only (S14-2)', () => {
    const text = '現在のパスワードが違います'
    const out = renderToStaticMarkup(
      <ChangePasswordFormView {...passwordProps} state={failed({ currentPassword: [text] })} fieldError={(n) => (n === 'currentPassword' ? text : undefined)} />,
    )
    expect(out).toMatch(/id="currentPassword-error"[^>]*>現在のパスワードが違います</)
    expect(out).not.toContain('id="newPassword-error"')
    expect(out).not.toContain('id="newPasswordConfirm-error"')
  })
  it('shows password_same_as_current under the new password field (S14-4)', () => {
    const text = '現在と異なるパスワードを指定してください'
    const out = renderToStaticMarkup(
      <ChangePasswordFormView {...passwordProps} state={failed({ newPassword: [text] })} fieldError={(n) => (n === 'newPassword' ? text : undefined)} />,
    )
    expect(out).toMatch(/id="newPassword-error"[^>]*>現在と異なるパスワードを指定してください</)
  })
  it('shows password_mismatch under the confirmation field', () => {
    const text = 'パスワードが一致しません'
    const out = renderToStaticMarkup(
      <ChangePasswordFormView {...passwordProps} state={failed({ newPasswordConfirm: [text] })} fieldError={(n) => (n === 'newPasswordConfirm' ? text : undefined)} />,
    )
    expect(out).toMatch(/id="newPasswordConfirm-error"[^>]*>パスワードが一致しません</)
  })
  it('does not render typed values (password fields carry no value attribute, so an error never echoes them)', () => {
    expect(html).not.toMatch(/<input[^>]*\svalue=/)
  })
  it('shows a non-field error in the form-level alert', () => {
    const out = renderToStaticMarkup(
      <ChangePasswordFormView {...passwordProps} state={{ ok: false, error: { code: 'RATE_LIMITED', message: 'しばらく時間をおいてから再度お試しください' } }} />,
    )
    expect(out).toContain('role="alert"')
    expect(out).toContain('しばらく時間をおいてから再度お試しください')
  })
})

describe('checkChangePassword (client-side check)', () => {
  it('accepts a valid triple', () => {
    expect(checkChangePassword('old-password-1', 'a-new-password-12', 'a-new-password-12')).toBeNull()
  })
  it('requires the current password', () => {
    expect(checkChangePassword('', 'a-new-password-12', 'a-new-password-12')).toEqual({ currentPassword: '入力してください' })
  })
  it('maps length and mismatch to the new password fields', () => {
    expect(checkChangePassword('x', 'short', 'short')).toEqual({ newPassword: '12 文字以上で入力してください' })
    expect(checkChangePassword('x', 'a-new-password-12', 'a-new-password-13')).toEqual({ newPasswordConfirm: 'パスワードが一致しません' })
    expect(checkChangePassword('x', 'a'.repeat(73), 'a'.repeat(73))).toEqual({ newPassword: '72 文字以内で入力してください' })
  })
})
