import { describe, expect, it, vi } from 'vitest'
import { AppError, appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { accessLogService, DELETED_USER_NAME, type AccessLogDbRow, type AccessLogDeps } from './access-logs'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const FILE = '00000000-0000-4000-8000-000000000020'
const now = new Date('2026-10-08T03:00:00.000Z')
const ctx: ServiceContext = {
  actor: { userId: 'a1', email: 'a1@example.com', displayName: 'A1', role: 'admin' },
  requestMeta: { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'r1' },
  now,
  actionName: 'accessLogs.test',
}

function row(over: Partial<AccessLogDbRow> = {}): AccessLogDbRow {
  return {
    id: 1,
    occurredAt: new Date('2026-10-08T02:00:00.000Z'),
    fileId: FILE,
    fileName: 'report.html',
    via: 'member',
    purpose: 'view',
    result: 'granted',
    denyReason: null,
    userId: 'u1',
    userName: 'User One',
    shareLinkId: null,
    linkLabel: null,
    linkHint: null,
    deliveredAt: new Date('2026-10-08T02:00:01.000Z'),
    bytesSent: 1234,
    ip: '203.0.113.1',
    userAgent: 'UA',
    ...over,
  }
}

function deps(rows: AccessLogDbRow[] = [], total = rows.length) {
  const listRows = vi.fn<AccessLogDeps['listRows']>(async () => ({ items: rows, total }))
  const assertManage = vi.fn<AccessLogDeps['assertManage']>(async () => undefined)
  return { d: { assertManage, listRows } satisfies AccessLogDeps, listRows, assertManage }
}

describe('accessLogService.listForFolder (06 9.7)', () => {
  it('authorizes with manage before reading; a non-manager error propagates and nothing is read', async () => {
    const { d, listRows, assertManage } = deps([row()])
    assertManage.mockRejectedValueOnce(appError('FORBIDDEN', 'common.forbidden'))
    await expect(accessLogService.listForFolder(ctx, FOLDER, {}, {}, d)).rejects.toBeInstanceOf(AppError)
    expect(listRows).not.toHaveBeenCalled()
    const ok = deps([row()])
    await accessLogService.listForFolder(ctx, FOLDER, {}, {}, ok.d)
    expect(ok.assertManage).toHaveBeenCalledWith(ctx, FOLDER)
  })

  it('a non-uuid folder id is NOT_FOUND without touching authorization', async () => {
    const { d, assertManage } = deps()
    await expect(accessLogService.listForFolder(ctx, 'x', {}, {}, d)).rejects.toMatchObject({ shape: { code: 'NOT_FOUND' } })
    expect(assertManage).not.toHaveBeenCalled()
  })

  it('maps a user viewer, a deleted-profile viewer and a share link viewer', async () => {
    const rows = [
      row({ id: 3 }),
      row({ id: 2, userName: null }),
      row({ id: 1, via: 'share_link', userId: null, shareLinkId: 'l1', linkLabel: 'partner', linkHint: 'abcd' }),
    ]
    const r = await accessLogService.listForFolder(ctx, FOLDER, {}, {}, deps(rows).d)
    expect(r.items.map((i) => i.viewer)).toEqual([
      { kind: 'user', userId: 'u1', displayName: 'User One' },
      { kind: 'user', userId: 'u1', displayName: DELETED_USER_NAME },
      { kind: 'share_link', linkId: 'l1', label: 'partner', tokenHint: 'abcd' },
    ])
    expect(JSON.stringify(r)).not.toMatch(/token_?hash/i)
  })

  it('delivered = delivered_at set AND bytes_sent > 0', async () => {
    const rows = [
      row({ id: 4 }),
      row({ id: 3, bytesSent: 0 }),
      row({ id: 2, deliveredAt: null, bytesSent: null }),
      row({ id: 1, deliveredAt: new Date('2026-10-08T02:00:01.000Z'), bytesSent: null }),
    ]
    const r = await accessLogService.listForFolder(ctx, FOLDER, {}, {}, deps(rows).d)
    expect(r.items.map((i) => i.delivered)).toEqual([true, false, false, false])
  })

  it('returns ISO strings, keeps the row of a file that no longer has a name, and exposes ip / userAgent', async () => {
    const r = await accessLogService.listForFolder(ctx, FOLDER, {}, {}, deps([row({ fileName: null, result: 'denied', denyReason: 'SUSPENDED', deliveredAt: null, bytesSent: null })]).d)
    expect(r.items[0]).toMatchObject({
      occurredAt: '2026-10-08T02:00:00.000Z',
      file: { id: FILE, displayName: '' },
      result: 'denied',
      denyReason: 'SUSPENDED',
      ip: '203.0.113.1',
      userAgent: 'UA',
    })
  })

  it('drops invalid filter values and converts from/to to Dates', async () => {
    const { d, listRows } = deps()
    await accessLogService.listForFolder(
      ctx,
      FOLDER,
      { fileId: 'nope', result: 'bad' as never, via: 'member', from: '2026-10-01T00:00:00.000Z', to: 'yesterday' },
      {},
      d,
    )
    expect(listRows).toHaveBeenCalledWith(
      FOLDER,
      { fileId: undefined, result: undefined, via: 'member', from: new Date('2026-10-01T00:00:00.000Z'), to: undefined },
      { page: 1, pageSize: 50 },
    )
  })

  it('normalises the page (invalid -> 1) and reports page, pageSize and total', async () => {
    const a = deps([], 120)
    const r = await accessLogService.listForFolder(ctx, FOLDER, {}, { page: 0 }, a.d)
    expect(a.listRows.mock.calls[0]?.[2]).toEqual({ page: 1, pageSize: 50 })
    expect(r).toEqual({ items: [], page: 1, pageSize: 50, total: 120 })
    const b = deps([], 120)
    expect((await accessLogService.listForFolder(ctx, FOLDER, {}, { page: 3 }, b.d)).page).toBe(3)
    expect(b.listRows.mock.calls[0]?.[2]).toEqual({ page: 3, pageSize: 50 })
  })
})
