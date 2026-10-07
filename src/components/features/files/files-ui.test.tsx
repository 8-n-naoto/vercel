// S06 / S07 / S05 files tab rendering and branches (08 5.5 - 5.7, 4.9) via react-dom/server. No DOM here: branches are driven by the props of
// the pure views; the click paths need the dev DB and are covered by e2e/files.spec.ts (skipped without it).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FileDetail, MemberFileDetail, UploadContext } from '@/lib/dto'
import type { ActionResult } from '@/lib/errors'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }) }))
vi.mock('@/app/_actions/files', () => ({
  filesStartUpload: () => Promise.resolve({ ok: false }),
  filesFinalizeUpload: () => Promise.resolve({ ok: false }),
  filesCancelUpload: () => Promise.resolve({ ok: true, data: null }),
  filesUpdate: () => Promise.resolve({ ok: false }),
  filesUpdateRestrictions: () => Promise.resolve({ ok: false }),
  filesDelete: () => Promise.resolve({ ok: false }),
}))

import { FileInfoFormView, changedFields } from './file-info-form'
import { FileSortSelect, SORT_OPTIONS, sortHref } from './file-sort-select'
import { FileTable } from './file-table'
import { MemberFileCard } from './member-file-card'
import { RestrictionsFormView, checkRestrictionsInput } from './restrictions-form'
import { UploadFormView, type UploadFormViewProps } from './upload-form'

const none = () => undefined
const MB = 1024 * 1024
const ctx: UploadContext = {
  folder: { id: 'f', name: '設計資料' },
  maxFileSizeBytes: 50 * MB,
  userQuota: { usedBytes: 1 * MB, limitBytes: 100 * MB },
  totalQuota: { usedBytes: 2 * MB, limitBytes: 200 * MB },
}
const baseUpload: UploadFormViewProps = {
  ctx,
  file: null,
  displayName: '',
  selectError: null,
  notice: null,
  phase: { kind: 'idle' },
  error: null,
  
  onReset: none,
  onDisplayName: none,
  onSubmit: none,
  onCancel: none,
}
const upload = (o: Partial<UploadFormViewProps> = {}): string => renderToStaticMarkup(<UploadFormView {...baseUpload} {...o} />)

describe('UploadFormView (08 5.6 S06)', () => {
  it('idle without a file: drop zone text S06-N1, picker button, notes N2-N4, upload disabled, no multiple attribute', () => {
    const html = upload()
    expect(html).toContain('ここに HTML ファイルをドロップ、または [ファイルを選択]／.html / .htm、1 ファイル 50MB まで')
    expect(html).toContain('ファイルを選択')
    expect(html).toContain('残り容量: あなた')
    expect(html).toContain('全体')
    expect(html).toContain('※ 外部の CDN・画像・フォントを読み込む HTML は正しく表示されません')
    expect(html).toContain('※ アップロードしたファイルはバックアップされません')
    expect(html).toContain('accept=".html,.htm,text/html"')
    expect(html).not.toContain('multiple')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>アップロード<\/button>/)
    expect(html).not.toContain('キャンセル')
  })
  it('a valid selection shows "name (size)", [選び直す], the display name, and enables upload', () => {
    const html = upload({ file: { name: 'a.html', size: 1024 }, displayName: 'a' })
    expect(html).toContain('a.html（1KB）')
    expect(html).toContain('選び直す')
    expect(html).toContain('value="a"')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>アップロード<\/button>/)
  })
  it('S06-2: a selection error is shown as an alert and keeps upload disabled', () => {
    const html = upload({ file: { name: 'a.txt', size: 10 }, selectError: '.html または .htm のファイルを選択してください' })
    expect(html).toContain('.html または .htm のファイルを選択してください')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>アップロード<\/button>/)
  })
  it('uploading: progress bar with aria-valuenow, "n%", and [キャンセル]; upload disabled', () => {
    const html = upload({ file: { name: 'a.html', size: 10 }, phase: { kind: 'uploading', percent: 42 } })
    expect(html).toContain('data-testid="upload-progress"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('42%')
    expect(html).toContain('キャンセル')
    expect(html).toContain('処理中…')
  })
  it('starting / finalizing have no [キャンセル] (only the transfer can be cancelled)', () => {
    for (const kind of ['starting', 'finalizing'] as const) {
      const html = upload({ file: { name: 'a.html', size: 10 }, phase: { kind } })
      expect(html).not.toContain('キャンセル')
      expect(html).toContain('処理中…')
    }
  })
  it('S06-M1 / S06-M2 notices and server errors (message + displayName field error)', () => {
    expect(upload({ notice: '1 回に 1 ファイルだけアップロードできます' })).toContain('1 回に 1 ファイルだけアップロードできます')
    expect(upload({ notice: 'アップロードを取り消しました' })).toContain('アップロードを取り消しました')
    const html = upload({
      file: { name: 'a.html', size: 10 },
      error: { code: 'VALIDATION_FAILED', message: '入力内容を確認してください', fieldErrors: { displayName: ['200 文字以内で入力してください'] } },
    })
    expect(html).toContain('入力内容を確認してください')
    expect(html).toContain('id="displayName-error"')
    expect(html).toContain('200 文字以内で入力してください')
  })
  it('S06-3: the verification message from the server is shown as the form error', () => {
    const html = upload({ error: { code: 'UPLOAD_VERIFICATION_FAILED', message: 'テキスト（HTML）ではないファイルです。UTF-16 で保存されている場合は UTF-8 で保存し直してください' } })
    expect(html).toContain('テキスト（HTML）ではないファイルです')
  })
})

const restrictions = { suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, downloadAllowed: false }
const detail = (o: Partial<FileDetail> = {}): FileDetail => ({
  id: 'f1',
  folderId: 'fo1',
  folderName: '設計資料',
  displayName: '仕様書',
  originalFilename: 'spec.html',
  sizeBytes: 2048,
  charset: 'utf-8',
  displayState: 'public',
  restrictions,
  uploadedBy: { id: 'u', displayName: '管理者' },
  activatedAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...o,
})
const okState = (d: FileDetail): ActionResult<FileDetail> => ({ ok: true, data: d })

describe('RestrictionsFormView (08 4.9)', () => {
  const view = (o: Partial<Parameters<typeof RestrictionsFormView>[0]> = {}): string =>
    renderToStaticMarkup(
      <RestrictionsFormView
        restrictions={restrictions}
        displayState="public"
        state={null}
        pending={false}
        suspended={false}
        downloadAllowed={false}
        onSuspended={none}
        onDownloadAllowed={none}
        onSubmit={none}
        fieldError={() => undefined}
        {...o}
      />,
    )
  it('shows the heading, the current state badge, radios, date fields with clear buttons, notes N1 / N2 and [保存]', () => {
    const html = view()
    expect(html).toContain('閲覧制限（すべての閲覧方法に適用）')
    expect(html).toContain('現在の状態:')
    expect(html).toContain('公開中')
    expect(html).toContain('公開する')
    expect(html).toContain('公開を停止する')
    expect(html).toContain('開始（日本時間）')
    expect(html).toContain('終了（日本時間）')
    expect(html).toContain('有効期限（日本時間）')
    expect(html).toContain('過ぎると閲覧できなくなり、30 日後に自動で削除されます')
    expect(html).toContain('許可する')
    expect(html).toContain('※ ダウンロード不可にしても、閲覧者はブラウザの機能で内容を保存できます。')
    expect(html).toContain('保存')
    expect((html.match(/クリア/g) ?? []).length).toBe(3)
  })
  it('suspended is sent through the hidden input', () => {
    expect(view({ suspended: true })).toContain('name="suspended" value="true"')
    expect(view({ downloadAllowed: true })).toContain('name="downloadAllowed" value="true"')
  })
  it('S07-2: fieldErrors.viewEndsAt is shown under the end field', () => {
    const html = view({
      state: { ok: false, error: { code: 'VALIDATION_FAILED', message: '入力内容を確認してください', fieldErrors: { viewEndsAt: ['終了日時は開始日時より後にしてください'] } } },
      fieldError: (n) => (n === 'viewEndsAt' ? '終了日時は開始日時より後にしてください' : undefined),
    })
    expect(html).toContain('id="viewEndsAt-error"')
    expect(html).toContain('終了日時は開始日時より後にしてください')
  })
  it('S07-1: after a successful save the success text is shown and the badge follows the returned FileDetail', () => {
    const html = view({ state: okState(detail({ displayState: 'suspended', restrictions: { ...restrictions, suspended: true } })) })
    expect(html).toContain('保存しました')
    expect(html).toContain('公開停止')
  })
  it('a NOT_FOUND-like failure is shown as the form error', () => {
    const html = view({ state: { ok: false, error: { code: 'NOT_FOUND', message: '対象が見つかりません。画面を再読み込みしてください' } } })
    expect(html).toContain('対象が見つかりません')
  })
})

describe('checkRestrictionsInput (client check before sending, 07 12)', () => {
  const now = new Date('2026-10-10T00:00:00.000Z')
  it('S07-2: end not after start is an error on viewEndsAt', () => {
    const e = checkRestrictionsInput({ viewStartsAt: '2026-10-20T09:00:00+09:00', viewEndsAt: '2026-10-19T09:00:00+09:00', expiresAt: null }, null, now)
    expect(e).toEqual({ viewEndsAt: '終了日時は開始日時より後にしてください' })
  })
  it('a changed expiresAt in the past is an error; an unchanged past one is allowed; null is allowed', () => {
    expect(checkRestrictionsInput({ viewStartsAt: null, viewEndsAt: null, expiresAt: '2026-10-01T00:00:00+09:00' }, null, now)).toEqual({
      expiresAt: '有効期限には現在より後の日時を指定してください',
    })
    expect(checkRestrictionsInput({ viewStartsAt: null, viewEndsAt: null, expiresAt: '2026-10-01T00:00:00+09:00' }, '2026-09-30T15:00:00.000Z', now)).toEqual({})
    expect(checkRestrictionsInput({ viewStartsAt: null, viewEndsAt: null, expiresAt: null }, '2026-09-30T15:00:00.000Z', now)).toEqual({})
  })
  it('an unparsable value is left to the server (no client error)', () => {
    expect(checkRestrictionsInput({ viewStartsAt: null, viewEndsAt: null, expiresAt: '2026/10/10 09:00' }, null, now)).toEqual({})
  })
})

describe('FileInfoFormView / changedFields (08 5.7)', () => {
  const view = (o: Partial<Parameters<typeof FileInfoFormView>[0]> = {}): string =>
    renderToStaticMarkup(<FileInfoFormView file={detail()} state={null} pending={false} noChange={false} onSubmit={none} fieldError={() => undefined} {...o} />)
  it('shows the editable name, the original name, size, uploader, charset select and note N4', () => {
    const html = view()
    expect(html).toContain('value="仕様書"')
    expect(html).toContain('spec.html')
    expect(html).toContain('2KB')
    expect(html).toContain('管理者')
    expect(html).toContain('文字コード')
    expect(html).toContain('文字化けする場合は文字コードを変更してください')
  })
  it('shows "変更はありません" when nothing changed, and the displayName field error', () => {
    expect(view({ noChange: true })).toContain('変更はありません')
    const html = view({ fieldError: (n) => (n === 'displayName' ? '入力してください' : undefined) })
    expect(html).toContain('id="displayName-error"')
  })
  it('changedFields sends only the changed fields', () => {
    const cur = { displayName: '仕様書', charset: 'utf-8' as const }
    expect(changedFields(cur, { displayName: ' 仕様書 ', charset: 'utf-8' })).toEqual({})
    expect(changedFields(cur, { displayName: '新名称', charset: 'utf-8' })).toEqual({ displayName: '新名称' })
    expect(changedFields(cur, { displayName: '仕様書', charset: 'shift_jis' })).toEqual({ charset: 'shift_jis' })
    expect(changedFields(cur, { displayName: '', charset: 'bogus' })).toEqual({ displayName: '' })
  })
})

describe('MemberFileCard (08 5.7 member view, S07-6)', () => {
  const member: MemberFileDetail = { id: 'f1', folderId: 'fo1', folderName: '設計資料', displayName: '仕様書', sizeBytes: 2048, updatedAt: '2026-10-10T00:00:00.000Z', downloadAllowed: false }
  it('shows size, update time, download flag and [開く] only', () => {
    const html = renderToStaticMarkup(<MemberFileCard file={member} />)
    expect(html).toContain('2KB')
    expect(html).toContain('ダウンロード')
    expect(html).toContain('不可')
    expect(html).toContain('href="/view/f1"')
    for (const hidden of ['削除', 'プレビュー', '閲覧制限', '公開リンク']) expect(html).not.toContain(hidden)
  })
  it('download allowed is 可', () => {
    expect(renderToStaticMarkup(<MemberFileCard file={{ ...member, downloadAllowed: true }} />)).toContain('可')
  })
})

describe('FileTable / sort (08 5.5 files tab, S05-7)', () => {
  it('sort options and URL', () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(['updated_desc', 'name_asc', 'size_desc'])
    expect(sortHref('fo1', 'name_asc')).toBe('/folders/fo1?sort=name_asc')
  })
  it('the sort select is rendered only when there are files', () => {
    expect(renderToStaticMarkup(<FileSortSelect folderId="fo1" sort="name_asc" />)).toContain('id="file-sort"')
    const withFiles = renderToStaticMarkup(
      <FileTable
        folderId="fo1"
        sort="updated_desc"
        list={{ access: 'member', files: [{ id: 'f1', folderId: 'fo1', displayName: '仕様書', sizeBytes: 1, updatedAt: '2026-10-10T00:00:00.000Z' }] }}
      />,
    )
    expect(withFiles).toContain('並べ替え')
    const empty = renderToStaticMarkup(<FileTable folderId="fo1" sort="updated_desc" list={{ access: 'admin', files: [] }} />)
    expect(empty).not.toContain('並べ替え')
    expect(empty).toContain('ファイルはまだありません。[アップロード] から追加してください')
  })
})
