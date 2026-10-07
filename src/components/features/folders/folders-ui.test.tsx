// S04 / S05 / S12 and D01 rendering and branches (08 5.4 / 5.5 / 5.12 / 4.6) via react-dom/server. No DOM here, so branches are driven by
// the props of the pure views; the click path (useActionForm to Action) needs a DB and is covered by e2e/folders.spec.ts.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminFolderRow, FolderSummary } from '@/lib/dto'
import type { ActionResult } from '@/lib/errors'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }))
vi.mock('@/app/_actions/folders', () => ({
  foldersCreate: () => Promise.resolve({ ok: true, data: { folderId: 'x' } }),
  foldersUpdate: () => Promise.resolve({ ok: true, data: null }),
  foldersDelete: () => Promise.resolve({ ok: true, data: { deletedFiles: 0, revokedLinks: 0, purgeFailed: 0 } }),
}))

import { AdminFolderTableView } from './admin-folder-table'
import { CreateFolderFormView } from './create-folder-dialog'
import { FolderHeader } from './folder-header'
import { FolderList } from './folder-list'
import { FolderSettingsFormView } from './folder-settings-form'
import { FolderTabs, parseFolderTab, visibleTabs } from './folder-tabs'

const none = () => undefined
const ID = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'
const failed = (fieldErrors?: Record<string, string[]>): ActionResult<unknown> => ({
  ok: false,
  error: { code: 'VALIDATION_FAILED', message: 'エラーが発生しました（ID: r-1）', fieldErrors },
})
const folder = (o: Partial<FolderSummary> = {}): FolderSummary => ({
  id: ID,
  name: '設計資料',
  description: '年度の設計資料',
  fileCount: 2,
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...o,
})

describe('FolderList (08 5.4 S04)', () => {
  it('shows the name as a link to S05, the description and the columns (S04-4)', () => {
    const html = renderToStaticMarkup(<FolderList folders={[folder()]} isAdmin={false} />)
    expect(html).toContain(`href="/folders/${ID}"`)
    expect(html).toContain('設計資料')
    expect(html).toContain('年度の設計資料')
    for (const h of ['名前', '説明', 'ファイル数', '更新日時']) expect(html).toContain(h)
  })
  it('S04-3: the empty text differs between an admin and a member', () => {
    expect(renderToStaticMarkup(<FolderList folders={[]} isAdmin />)).toContain('[フォルダ作成]')
    const member = renderToStaticMarkup(<FolderList folders={[]} isAdmin={false} />)
    expect(member).toContain('管理者に追加を依頼してください')
    expect(member).not.toContain('<table')
  })
  it('renders a description as text, never as HTML', () => {
    const html = renderToStaticMarkup(<FolderList folders={[folder({ description: '<script>alert(1)</script>' })]} isAdmin={false} />)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('tabs (08 5.5, S05-1)', () => {
  it('a member sees only files and members; an admin sees four', () => {
    expect(visibleTabs('member')).toEqual(['files', 'members'])
    expect(visibleTabs('admin')).toEqual(['files', 'members', 'logs', 'settings'])
  })
  it('logs and settings fall back to files for a member, even when opened directly', () => {
    expect(parseFolderTab('logs', 'member')).toBe('files')
    expect(parseFolderTab('settings', 'member')).toBe('files')
    expect(parseFolderTab('logs', 'admin')).toBe('logs')
    expect(parseFolderTab('settings', 'admin')).toBe('settings')
    expect(parseFolderTab('members', 'member')).toBe('members')
  })
  it('an unknown or missing value is files', () => {
    expect(parseFolderTab(undefined, 'admin')).toBe('files')
    expect(parseFolderTab('nope', 'admin')).toBe('files')
  })
  it('renders no link for the admin-only tabs to a member, and marks the current tab once', () => {
    const member = renderToStaticMarkup(<FolderTabs folderId={ID} current="files" access="member" />)
    expect(member).not.toContain('tab=logs')
    expect(member).not.toContain('tab=settings')
    const admin = renderToStaticMarkup(<FolderTabs folderId={ID} current="settings" access="admin" />)
    expect(admin).toContain('tab=logs')
    expect(admin.match(/aria-current="page"/g)).toHaveLength(1)
  })
})

describe('FolderHeader (08 5.5)', () => {
  const detail = { id: ID, name: '設計資料', description: '一行目\n二行目', access: 'admin' } as const
  it('shows the upload link to an admin only', () => {
    expect(renderToStaticMarkup(<FolderHeader detail={detail} />)).toContain(`/folders/${ID}/upload`)
    expect(renderToStaticMarkup(<FolderHeader detail={{ ...detail, access: 'member' }} />)).not.toContain('/upload')
  })
  it('keeps line breaks of the description without interpreting it', () => {
    const html = renderToStaticMarkup(<FolderHeader detail={detail} />)
    expect(html).toContain('whitespace-pre-wrap')
    expect(html).toContain('一行目\n二行目')
  })
})

describe('CreateFolderFormView (08 4.6 D01)', () => {
  const props = { state: null, pending: false, onSubmit: none, fieldError: () => undefined } as const
  it('has the name (maxLength 100) and description (maxLength 500) fields and the submit button', () => {
    const html = renderToStaticMarkup(<CreateFolderFormView {...props} />)
    expect(html).toContain('maxLength="100"')
    expect(html).toContain('maxLength="500"')
    expect(html).toContain('type="submit"')
    expect(html).toContain('作成')
  })
  it('D01-1: the field error is shown under the name and wired with aria', () => {
    const html = renderToStaticMarkup(<CreateFolderFormView {...props} fieldError={(n) => (n === 'name' ? '入力してください' : undefined)} />)
    expect(html).toContain('入力してください')
    expect(html).toContain('aria-invalid="true"')
  })
  it('D01-3: while pending the button reads 処理中… and is disabled', () => {
    const html = renderToStaticMarkup(<CreateFolderFormView {...props} pending />)
    expect(html).toContain('処理中…')
    expect(html).toContain('disabled')
  })
  it('shows a whole-form error from the server message', () => {
    expect(renderToStaticMarkup(<CreateFolderFormView {...props} state={failed()} />)).toContain('エラーが発生しました（ID: r-1）')
  })
})

describe('FolderSettingsFormView (08 5.5)', () => {
  const props = { name: '設計資料', description: '説明文', state: null, pending: false, onSubmit: none, fieldError: () => undefined } as const
  it('starts from the current values and shows no success text', () => {
    const html = renderToStaticMarkup(<FolderSettingsFormView {...props} />)
    expect(html).toContain('value="設計資料"')
    expect(html).toContain('説明文')
    expect(html).not.toContain('保存しました')
  })
  it('shows 保存しました after success', () => {
    expect(renderToStaticMarkup(<FolderSettingsFormView {...props} state={{ ok: true, data: null }} />)).toContain('保存しました')
  })
})

describe('AdminFolderTableView (08 5.12 S12)', () => {
  const row: AdminFolderRow = {
    id: ID,
    name: '設計資料',
    memberCount: 3,
    fileCount: 5,
    usedBytes: 1258291,
    activeShareLinkCount: 2,
    createdBy: { id: 'u1', displayName: '管理者A' },
    updatedAt: '2026-10-10T00:00:00.000Z',
  }
  it('shows every column, the open link and the delete button', () => {
    const html = renderToStaticMarkup(<AdminFolderTableView rows={[row]} notice={null} onDeleted={none} />)
    for (const h of ['名前', 'メンバー数', 'ファイル数', '使用容量', '有効リンク', '作成者', '更新日時', '操作']) expect(html).toContain(h)
    expect(html).toContain('管理者A')
    expect(html).toContain(`href="/folders/${ID}"`)
    expect(html).toContain('削除')
  })
  it('empty state has no table', () => {
    expect(renderToStaticMarkup(<AdminFolderTableView rows={[]} notice={null} onDeleted={none} />)).not.toContain('<table')
  })
  it('S12-2: the deletion result is shown above the table', () => {
    const html = renderToStaticMarkup(<AdminFolderTableView rows={[row]} notice="フォルダを削除しました（ファイル 3 件、公開リンク 2 本）" onDeleted={none} />)
    expect(html).toContain('フォルダを削除しました（ファイル 3 件、公開リンク 2 本）')
  })
})
