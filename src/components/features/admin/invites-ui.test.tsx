// S10 rendering and branches (08 5.10) via react-dom/server. There is no DOM in this setup, so each branch is driven by the props of the
// pure views; the hook wiring (useActionForm -> onSuccess) is covered by the shared use-action-form code and by E2E once WP-2.3 lands.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { InviteRow } from '@/lib/dto'
import type { ActionResult, AppErrorShape } from '@/lib/errors'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))
vi.mock('@/app/_actions/admin', () => ({
  adminCreateInvite: () => Promise.resolve({ ok: true, data: null }),
  adminRevokeInvite: () => Promise.resolve({ ok: true, data: null }),
}))
// The real dialog is a Radix portal, which renders nothing on the server. A marker shows that it is mounted and with which props.
vi.mock('@/components/features/common/one-time-url-dialog', () => ({
  OneTimeUrlDialog: (p: { title: string; kind: string; url: string; expiresAt: string }) => (
    <div data-testid="d04" data-kind={p.kind} data-expires={p.expiresAt}>
      {p.title}:{p.url}
    </div>
  ),
}))

import { InviteFormView, INVITE_NOTE } from './invite-form'
import { InviteTableView, INVITE_EMPTY_TEXT } from './invite-table'
import { InviteStateTabs, parseInviteState } from './invite-state-tabs'
import { revokeConfirmText, revokeInviteAndReport } from './revoke-invite-button'

const none = () => undefined
const err = (code: AppErrorShape['code'], message: string, fieldErrors?: Record<string, string[]>): AppErrorShape => ({ code, message, fieldErrors })
const formProps = {
  state: null,
  pending: false,
  onSubmit: none,
  fieldError: () => undefined,
  issued: null,
  onCloseUrl: none,
  formKey: 0,
} as const

const row = (o: Partial<InviteRow>): InviteRow => ({
  id: '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60',
  email: 'new@example.com',
  role: 'user',
  state: 'open',
  expiresAt: '2026-10-15T00:00:00.000Z',
  usedAt: null,
  revokedAt: null,
  createdBy: { id: 'a', displayName: '管理者A' },
  createdAt: '2026-10-08T00:00:00.000Z',
  ...o,
})

describe('InviteFormView (08 5.10)', () => {
  it('shows the labelled fields, the submit button and the S10-N1 note, and no URL dialog', () => {
    const html = renderToStaticMarkup(<InviteFormView {...formProps} />)
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>メールアドレス<\/label>/)
    expect(html).toMatch(/<label[^>]*for="role"[^>]*>役割<\/label>/)
    expect(html).toContain('招待 URL を発行')
    expect(html).toContain('type="submit"')
    expect(html).toContain(INVITE_NOTE)
    expect(INVITE_NOTE).toBe('※ 同じメールアドレスの未使用の招待は自動的に取り消されます')
    expect(html).not.toContain('data-testid="d04"')
  })
  it('after an issue the one-time dialog is mounted as kind=invite with the URL and the expiry', () => {
    const issued = { url: 'https://app.example.com/invite/' + 'A'.repeat(43), expiresAt: '2026-10-15T00:00:00.000Z' }
    const html = renderToStaticMarkup(<InviteFormView {...formProps} issued={issued} />)
    expect(html).toContain('data-kind="invite"')
    expect(html).toContain(issued.url)
    expect(html).toContain('data-expires="2026-10-15T00:00:00.000Z"')
  })
  it('closing drops the URL: no dialog and the URL is nowhere in the markup (D04-2)', () => {
    const html = renderToStaticMarkup(<InviteFormView {...formProps} issued={null} />)
    expect(html).not.toContain('/invite/')
  })
  it('invite.email_registered (CONFLICT) is shown as a form error and no dialog is mounted (S10-2)', () => {
    const state: ActionResult<unknown> = { ok: false, error: err('CONFLICT', 'このメールアドレスのユーザーは既に登録されています') }
    const html = renderToStaticMarkup(<InviteFormView {...formProps} state={state} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('このメールアドレスのユーザーは既に登録されています')
    expect(html).not.toContain('data-testid="d04"')
  })
  it('a field error is attached to the email input', () => {
    const html = renderToStaticMarkup(<InviteFormView {...formProps} fieldError={(n) => (n === 'email' ? '入力してください' : undefined)} />)
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('id="email-error"')
  })
  it('the submit button shows 処理中… and is disabled while pending', () => {
    const html = renderToStaticMarkup(<InviteFormView {...formProps} pending />)
    expect(html).toContain('処理中…')
    expect(html).toContain('disabled')
  })
})

describe('InviteTableView (08 5.10)', () => {
  it('empty -> 招待はありません and no table', () => {
    const html = renderToStaticMarkup(<InviteTableView items={[]} revokeError={null} onRevokeError={none} />)
    expect(html).toContain(INVITE_EMPTY_TEXT)
    expect(INVITE_EMPTY_TEXT).toBe('招待はありません')
    expect(html).not.toContain('<table')
  })
  it('columns, role/state labels, and [取り消し] only for open rows', () => {
    const items = [
      row({ id: '1', email: 'open@example.com', state: 'open' }),
      row({ id: '2', email: 'used@example.com', state: 'used', role: 'admin' }),
      row({ id: '3', email: 'rev@example.com', state: 'revoked' }),
      row({ id: '4', email: 'exp@example.com', state: 'expired' }),
    ]
    const html = renderToStaticMarkup(<InviteTableView items={items} revokeError={null} onRevokeError={none} />)
    for (const h of ['宛先', '役割', '状態', '有効期限', '発行者', '発行日時', '操作']) expect(html).toContain(`>${h}</th>`)
    for (const l of ['未使用', '使用済み', '取り消し済み', '期限切れ', '管理者', '一般ユーザー', '管理者A']) expect(html).toContain(l)
    expect(html.match(/>取り消し<\/button>/g)).toHaveLength(1)
  })
  it('a failed revoke (invite.already_used) is shown above the table', () => {
    const e = err('CONFLICT', 'この招待は既に使用されているため取り消せません')
    const html = renderToStaticMarkup(<InviteTableView items={[row({})]} revokeError={e} onRevokeError={none} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('この招待は既に使用されているため取り消せません')
  })
})

describe('revokeInviteAndReport (C-06 / invite.already_used)', () => {
  it('C-06 text', () => {
    expect(revokeConfirmText('a@example.com')).toBe('a@example.com への招待を取り消します。この招待 URL は使えなくなります。')
  })
  it('success: the Action is called with the invite id and nothing is reported', async () => {
    const action = vi.fn<(input: { inviteId: string }) => Promise<ActionResult<null>>>(() => Promise.resolve({ ok: true, data: null }))
    const refresh = vi.fn()
    const onError = vi.fn()
    const r = await revokeInviteAndReport('id-1', { action, refresh, onError })
    expect(r.ok).toBe(true)
    expect(action).toHaveBeenCalledWith({ inviteId: 'id-1' })
    expect(onError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
  it('invite.already_used: the error is reported for FormError and the list is refreshed', async () => {
    const e = err('CONFLICT', 'この招待は既に使用されているため取り消せません')
    const refresh = vi.fn()
    const onError = vi.fn()
    const r = await revokeInviteAndReport('id-1', { action: () => Promise.resolve({ ok: false, error: e }), refresh, onError })
    expect(r.ok).toBe(false)
    expect(onError).toHaveBeenCalledWith(e)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('state switch (08 5.10)', () => {
  it('parseInviteState accepts the four states and treats anything else as all', () => {
    expect(parseInviteState('open')).toBe('open')
    expect(parseInviteState(['used', 'x'])).toBe('used')
    expect(parseInviteState('revoked')).toBe('revoked')
    expect(parseInviteState('expired')).toBe('expired')
    expect(parseInviteState('bogus')).toBeUndefined()
    expect(parseInviteState(undefined)).toBeUndefined()
  })
  it('renders the five links and marks the current one', () => {
    const html = renderToStaticMarkup(<InviteStateTabs current="used" pathname="/admin/invites" />)
    for (const l of ['すべて', '未使用', '使用済み', '取り消し済み', '期限切れ']) expect(html).toContain(`>${l}</a>`)
    expect(html).toContain('href="/admin/invites?state=open"')
    expect(html).toContain('href="/admin/invites"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
})
