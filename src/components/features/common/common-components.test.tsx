// Rendering tests for the common components that need no DOM (08 4). Server rendering via react-dom/server.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppErrorShape } from '@/lib/errors'
import { DateTime } from './date-time'
import { DateTimeField } from './date-time-field'
import { deleteNameMatches } from './confirm-delete-dialog'
import { ErrorScreen } from './error-screen'
import { FieldError, FormError } from './form-message'
import { loginRedirectUrl } from './handle-common-error'
import { ONE_TIME_URL_NOTICE } from './one-time-url-dialog'
import { Pagination, parsePageParam, totalPagesOf } from './pagination'
import { StatusBadge, statusBadgeView } from './status-badge'
import { clientValidationFailed } from './use-action-form'

const err = (e: Partial<AppErrorShape> & Pick<AppErrorShape, 'code' | 'message'>): AppErrorShape => e

describe('StatusBadge (07 11 / 08 4.12)', () => {
  it('file labels and tones', () => {
    expect(statusBadgeView({ kind: 'file', value: 'public' })).toEqual({ label: '公開中', tone: 'green' })
    expect(statusBadgeView({ kind: 'file', value: 'suspended' })).toEqual({ label: '公開停止', tone: 'gray' })
    expect(statusBadgeView({ kind: 'file', value: 'ended' })).toEqual({ label: '公開終了', tone: 'gray' })
    expect(statusBadgeView({ kind: 'file', value: 'expired' })).toEqual({ label: '期限切れ', tone: 'gray' })
  })
  it('not_started shows the start time in Japan time: 公開前（MM/DD HH:mm〜）', () => {
    expect(statusBadgeView({ kind: 'file', value: 'not_started', viewStartsAt: '2026-10-10T00:00:00.000Z' })).toEqual({
      label: '公開前（10/10 09:00〜）',
      tone: 'blue',
    })
  })
  it('link, invite and user', () => {
    expect(statusBadgeView({ kind: 'link', value: 'active' })).toEqual({ label: '有効', tone: 'green' })
    expect(statusBadgeView({ kind: 'link', value: 'limit_reached' })).toEqual({ label: '回数上限', tone: 'yellow' })
    expect(statusBadgeView({ kind: 'link', value: 'revoked' }).tone).toBe('gray')
    expect(statusBadgeView({ kind: 'invite', value: 'open' })).toEqual({ label: '未使用', tone: 'green' })
    expect(statusBadgeView({ kind: 'invite', value: 'used' }).tone).toBe('gray')
    expect(statusBadgeView({ kind: 'user', value: 'enabled' })).toEqual({ label: '有効', tone: 'green' })
    expect(statusBadgeView({ kind: 'user', value: 'disabled' })).toEqual({ label: '無効', tone: 'gray' })
  })
  it('always renders the label text (colour is never the only signal)', () => {
    expect(renderToStaticMarkup(<StatusBadge kind="link" value="expired" />)).toContain('期限切れ')
  })
})

describe('DateTimeField (08 4.11 / 6.3)', () => {
  it('converts the DTO value (UTC) to a Japan-time input value and labels it 日本時間', () => {
    const html = renderToStaticMarkup(<DateTimeField name="viewEndsAt" label="終了日時" defaultIso="2026-12-31T15:30:00.000Z" />)
    expect(html).toContain('value="2027-01-01T00:30"')
    expect(html).toContain('終了日時（日本時間）')
    expect(html).toContain('type="datetime-local"')
    expect(html).toContain('step="60"')
    expect(html).toContain('name="viewEndsAt"')
  })
  it('empty value for null; clear button only when clearable', () => {
    expect(renderToStaticMarkup(<DateTimeField name="a" label="A" />)).toContain('value=""')
    expect(renderToStaticMarkup(<DateTimeField name="a" label="A" />)).not.toContain('クリア')
    expect(renderToStaticMarkup(<DateTimeField name="a" label="A" clearable />)).toContain('クリア')
  })
  it('links the error to the input', () => {
    const html = renderToStaticMarkup(<DateTimeField name="a" label="A" error="bad" />)
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="a-error"')
    expect(html).toContain('id="a-error"')
  })
})

describe('DateTime (08 4.15)', () => {
  it('wraps the Japan-time text in <time dateTime>', () => {
    expect(renderToStaticMarkup(<DateTime iso="2026-10-10T00:00:00.000Z" />)).toBe('<time dateTime="2026-10-10T00:00:00.000Z">2026/10/10 09:00</time>')
  })
  it('null -> em dash', () => expect(renderToStaticMarkup(<DateTime iso={null} />)).toBe('—'))
})

describe('FormError / FieldError (08 4.1)', () => {
  it('shows error.message in role=alert', () => {
    const html = renderToStaticMarkup(<FormError error={err({ code: 'CONFLICT', message: 'ほかの操作と同時に実行されました。もう一度お試しください' })} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('ほかの操作と同時に実行されました')
  })
  it('RATE_LIMITED appends the retry hint (E-03)', () => {
    const html = renderToStaticMarkup(<FormError error={err({ code: 'RATE_LIMITED', message: 'しばらく時間をおいてから再度お試しください', retryAfterSec: 30 })} />)
    expect(html).toContain('しばらく時間をおいてから再度お試しください（約 30 秒後に再試行できます）')
  })
  it('INTERNAL shows the message with the ID as is', () => {
    expect(renderToStaticMarkup(<FormError error={err({ code: 'INTERNAL', message: 'エラーが発生しました（ID: req-1）' })} />)).toContain('ID: req-1')
  })
  it('UNAUTHENTICATED and null render nothing', () => {
    expect(renderToStaticMarkup(<FormError error={err({ code: 'UNAUTHENTICATED', message: 'ログインしてください' })} />)).toBe('')
    expect(renderToStaticMarkup(<FormError error={null} />)).toBe('')
  })
  it('field errors for names that are not on the screen are shown in the form error (08 7.3)', () => {
    const e = err({ code: 'VALIDATION_FAILED', message: '入力内容を確認してください', fieldErrors: { token: ['入力内容が正しくありません'], name: ['入力してください'] } })
    const html = renderToStaticMarkup(<FormError error={e} knownFields={['name']} />)
    expect(html).toContain('入力内容が正しくありません')
    expect(html).not.toContain('入力してください')
  })
  it('FieldError has id {name}-error and renders nothing without a message', () => {
    expect(renderToStaticMarkup(<FieldError name="email" message="入力してください" />)).toContain('id="email-error"')
    expect(renderToStaticMarkup(<FieldError name="email" message={undefined} />)).toBe('')
  })
})

describe('ErrorScreen (08 4.14 / 5.15)', () => {
  it('not_found: E-01 with a folder list link', () => {
    const html = renderToStaticMarkup(<ErrorScreen variant="not_found" />)
    expect(html).toContain('ページが見つかりません')
    expect(html).toContain('href="/folders"')
    expect(html).toContain('フォルダ一覧へ')
  })
  it('S15-3: share_invalid shows E-02 and has no link at all', () => {
    const html = renderToStaticMarkup(<ErrorScreen variant="share_invalid" />)
    expect(html).toContain('リンクが無効か、期限が切れています')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })
  it('token_invalid and rate_limited have no link', () => {
    expect(renderToStaticMarkup(<ErrorScreen variant="token_invalid" />)).not.toContain('<a')
    const rl = renderToStaticMarkup(<ErrorScreen variant="rate_limited" retryAfterSec={61} />)
    expect(rl).toContain('しばらく時間をおいてから再度お試しください（約 2 分後に再試行できます）')
    expect(rl).not.toContain('<a')
  })
  it('internal shows the given message and the actions', () => {
    const html = renderToStaticMarkup(<ErrorScreen variant="internal" message="エラーが発生しました（ID: 123）" actions={<button>再試行</button>} />)
    expect(html).toContain('エラーが発生しました（ID: 123）')
    expect(html).toContain('再試行')
  })
})

describe('OneTimeUrlDialog notices (D04-3)', () => {
  it('uses U-01 / U-02 / U-03', () => {
    expect(ONE_TIME_URL_NOTICE.share_link).toBe('この URL は今だけ表示されます。閉じると再表示できません（必要なら再発行）。')
    expect(ONE_TIME_URL_NOTICE.invite).toBe('この URL は今だけ表示されます。閉じると再表示できません。1 回限り有効です。本人にだけ渡してください。')
    expect(ONE_TIME_URL_NOTICE.reset).toBe(ONE_TIME_URL_NOTICE.invite)
  })
})

describe('D05 name match (D05-1)', () => {
  it('empty or any 1-character difference is not a match; exact (case-sensitive, trimmed) is', () => {
    expect(deleteNameMatches('', 'Folder A')).toBe(false)
    expect(deleteNameMatches('Folder', 'Folder A')).toBe(false)
    expect(deleteNameMatches('folder A', 'Folder A')).toBe(false)
    expect(deleteNameMatches('Folder A', 'Folder A')).toBe(true)
    expect(deleteNameMatches('  Folder A  ', 'Folder A')).toBe(true)
  })
})

describe('Pagination (08 4.13)', () => {
  it('total pages and page parsing (06 1.5)', () => {
    expect(totalPagesOf(0, 50)).toBe(1)
    expect(totalPagesOf(101, 50)).toBe(3)
    expect(parsePageParam(undefined)).toBe(1)
    expect(parsePageParam('abc')).toBe(1)
    expect(parsePageParam('0')).toBe(1)
    expect(parsePageParam('3')).toBe(3)
  })
  it('keeps the query, disables the ends, hides at total 0', () => {
    const first = renderToStaticMarkup(<Pagination page={1} pageSize={50} total={120} pathname="/x" query={{ q: 'a' }} />)
    expect(first).toContain('1 / 3')
    expect(first).toContain('href="/x?q=a&amp;page=2"')
    expect(first).toContain('aria-disabled="true"')
    expect(renderToStaticMarkup(<Pagination page={1} pageSize={50} total={0} pathname="/x" />)).toBe('')
  })
})

describe('action helpers', () => {
  it('clientValidationFailed has the VALIDATION_FAILED shape with the first message per field', () => {
    const r = clientValidationFailed({ name: '入力してください' })
    expect(r).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: '入力内容を確認してください', fieldErrors: { name: ['入力してください'] } },
    })
  })
  it('UNAUTHENTICATED goes to /login?next=<encoded location> (08 7.3)', () => {
    expect(loginRedirectUrl('/folders/1?tab=files')).toBe('/login?next=%2Ffolders%2F1%3Ftab%3Dfiles')
  })
})
