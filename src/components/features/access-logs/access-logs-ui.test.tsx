// S05 logs tab (08 5.5) via react-dom/server: viewer texts, delivered states, deny reasons, no full token, filter form, pagination query.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccessLogRow, Page } from '@/lib/dto'
import { AccessLogFilter, DEFAULT_LOG_PERIOD, parseLogPeriod, periodFrom } from './access-log-filter'
import { AccessLogTab, logsQuery } from './access-log-tab'
import { AccessLogTable, deliveredText, viewerText } from './access-log-table'

const FULL_TOKEN = 'FULLTOKEN0123456789abcdefghijklmnopqrstuvwxyz'
const FOLDER = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'

function row(over: Partial<AccessLogRow> & Pick<AccessLogRow, 'id'>): AccessLogRow {
  return {
    occurredAt: '2026-10-08T00:30:00.000Z',
    file: { id: '1', displayName: 'report.html' },
    via: 'member', purpose: 'view', result: 'granted', denyReason: null,
    viewer: { kind: 'user', userId: 'u1', displayName: '山田太郎' },
    delivered: true, ip: '203.0.113.5', userAgent: 'UA/1.0',
    ...over,
  }
}

describe('viewerText', () => {
  it('shows the display name for a user', () => {
    expect(viewerText({ kind: 'user', userId: 'u', displayName: '山田太郎' })).toBe('山田太郎')
  })
  it('shows label and token hint for a share link', () => {
    expect(viewerText({ kind: 'share_link', linkId: 'l', label: '取引先A', tokenHint: 'wxyz' })).toBe('取引先A（…wxyz）')
  })
  it('shows a placeholder when the label is empty', () => {
    expect(viewerText({ kind: 'share_link', linkId: 'l', label: '', tokenHint: 'wxyz' })).toBe('（ラベルなし）（…wxyz）')
  })
})

describe('deliveredText', () => {
  it('granted + delivered -> 済, granted + not delivered -> 未, denied -> empty', () => {
    expect(deliveredText({ result: 'granted', delivered: true })).toBe('済')
    expect(deliveredText({ result: 'granted', delivered: false })).toBe('未')
    expect(deliveredText({ result: 'denied', delivered: false })).toBe('')
  })
})

describe('AccessLogTable', () => {
  const items: AccessLogRow[] = [
    row({ id: 1 }),
    row({ id: 2, result: 'denied', denyReason: 'LINK_EXPIRED', delivered: false, via: 'share_link', viewer: { kind: 'share_link', linkId: 'l', label: '取引先A', tokenHint: 'wxyz' } }),
    row({ id: 3, delivered: false, purpose: 'download', ip: null, userAgent: null }),
  ]
  const html = renderToStaticMarkup(<AccessLogTable items={items} />)

  it('renders labels for via / purpose / result / deny reason', () => {
    for (const t of ['メンバー', '公開リンク', '閲覧', 'ダウンロード', '許可', '拒否', 'リンク期限切れ', '取引先A（…wxyz）', '2026/10/08 09:30']) {
      expect(html).toContain(t)
    }
  })
  it('renders delivered states and puts ip / UA in details', () => {
    expect(html).toContain('済')
    expect(html).toContain('未')
    expect(html).toContain('<details>')
    expect(html).toContain('203.0.113.5')
  })
  it('never contains a full token', () => {
    expect(html).not.toContain(FULL_TOKEN)
  })
})

describe('period', () => {
  it('defaults to 7d on invalid values', () => {
    expect(parseLogPeriod(undefined)).toBe(DEFAULT_LOG_PERIOD)
    expect(parseLogPeriod('999d')).toBe('7d')
    expect(parseLogPeriod(['30d', '1d'])).toBe('30d')
    expect(parseLogPeriod('all')).toBe('all')
  })
  it('computes from, and leaves it out for all', () => {
    const now = new Date('2026-10-08T00:00:00.000Z')
    expect(periodFrom('1d', now)).toBe('2026-10-07T00:00:00.000Z')
    expect(periodFrom('7d', now)).toBe('2026-10-01T00:00:00.000Z')
    expect(periodFrom('all', now)).toBeUndefined()
  })
})

describe('AccessLogFilter', () => {
  it('is a GET form with tab=logs, the four fields and the submit button', () => {
    const html = renderToStaticMarkup(
      <AccessLogFilter period="7d" file="" result="denied" via="" files={[{ id: FOLDER, displayName: 'a.html' }]} />,
    )
    expect(html).toContain('method="get"')
    expect(html).toContain('name="tab" value="logs"')
    for (const n of ['name="period"', 'name="file"', 'name="result"', 'name="via"']) expect(html).toContain(n)
    expect(html).toContain('value="denied" selected')
    expect(html).toContain('a.html')
    expect(html).toContain('絞り込む')
  })
})

describe('AccessLogTab', () => {
  const page = (items: AccessLogRow[], total: number): Page<AccessLogRow> => ({ items, page: 1, pageSize: 50, total })
  it('shows the empty state', () => {
    const html = renderToStaticMarkup(
      <AccessLogTab folderId={FOLDER} list={page([], 0)} files={[]} period="7d" file="" result="" via="" />,
    )
    expect(html).toContain('この条件の閲覧ログはありません')
    expect(html).not.toContain('<table')
  })
  it('keeps the filter in pagination links', () => {
    const html = renderToStaticMarkup(
      <AccessLogTab folderId={FOLDER} list={page([row({ id: 1 })], 120)} files={[]} period="30d" file="" result="denied" via="share_link" />,
    )
    expect(html).toContain('1 / 3')
    expect(html).toContain(`/folders/${FOLDER}?tab=logs&amp;period=30d&amp;result=denied&amp;via=share_link&amp;page=2`)
  })
  it('logsQuery omits unset values', () => {
    expect(logsQuery({ period: 'all', file: '', result: '', via: '' })).toEqual({ tab: 'logs', period: 'all' })
  })
})
