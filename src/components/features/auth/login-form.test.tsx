// S01 rendering (08 5.1) via react-dom/server. Submission paths need a DB (WP-2.1) and are not covered here.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }))
vi.mock('@/app/_actions/auth', () => ({ authSignIn: () => Promise.resolve({ ok: true, data: null }) }))

import { LoginForm } from './login-form'
import { LOGIN_CHANGED_MESSAGE, LOGIN_NOTICE, parseLoginParams } from './login-params'

describe('LoginForm (08 5.1)', () => {
  const html = renderToStaticMarkup(<LoginForm next={null} />)
  it('shows the heading, labelled fields with the required type / autocomplete, and the notice', () => {
    expect(html).toContain('>ログイン</h1>')
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>メールアドレス<\/label>/)
    expect(html).toMatch(/<input[^>]*id="email"[^>]*type="email"|<input[^>]*type="email"[^>]*id="email"/)
    expect(html).toContain('autoComplete="username"')
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>パスワード<\/label>/)
    expect(html).toContain('type="password"')
    expect(html).toContain('autoComplete="current-password"')
    expect(html).toContain('type="submit"')
    expect(html).toContain(LOGIN_NOTICE)
  })
  it('has no links (no sign-up, no forgot-password)', () => {
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
  })
  it('carries next in a hidden input, empty when null', () => {
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="next"[^>]*value=""/)
    const withNext = renderToStaticMarkup(<LoginForm next="/admin/users" />)
    expect(withNext).toContain('value="/admin/users"')
  })
  it('shows no error before submission', () => {
    expect(html).not.toContain('role="alert"')
  })
})

describe('parseLoginParams (08 5.1)', () => {
  it('S01-3: only a relative path passes as next', () => {
    expect(parseLoginParams({ next: '/admin/users' }).next).toBe('/admin/users')
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil', '', undefined, ['/a', '/b']]) {
      expect(parseLoginParams({ next }).next, String(next)).toBeNull()
    }
  })
  it('S01-M1 is shown only for reset=1 or changed=1', () => {
    expect(parseLoginParams({ reset: '1' }).showChanged).toBe(true)
    expect(parseLoginParams({ changed: '1' }).showChanged).toBe(true)
    expect(parseLoginParams({ reset: '0' }).showChanged).toBe(false)
    expect(parseLoginParams({}).showChanged).toBe(false)
    expect(LOGIN_CHANGED_MESSAGE).toBe('パスワードを変更しました。新しいパスワードでログインしてください')
  })
})
