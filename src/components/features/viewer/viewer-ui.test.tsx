// ContentFrame / ViewerHeader rendering via react-dom/server (no DOM). Click paths need the dev DB: e2e/view.spec.ts.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MemberViewContext } from '@/lib/dto'
import { ContentFrame, FrameLoading, IFRAME_SANDBOX } from './content-frame'
import { ViewerHeader, type ViewerHeaderProps } from './viewer-header'

const none = () => undefined
const member: MemberViewContext = {
  file: { id: 'f1', displayName: '設計書', folderId: 'd1', folderName: '設計資料' },
  mode: 'member',
  previewNotice: null,
}
const base: ViewerHeaderProps = {
  context: member, canDownload: true, reloadDisabled: false, downloadPending: false, downloadError: null, onReload: none, onDownload: none,
}
const V01 = 'このページの内容は利用者がアップロードしたものです。パスワードや個人情報を入力しないでください。'

describe('ContentFrame', () => {
  const html = renderToStaticMarkup(<ContentFrame viewUrl="https://content.example/raw/abc" fileName="設計書" />)
  it('sandbox is exactly allow-scripts', () => {
    expect(IFRAME_SANDBOX).toBe('allow-scripts')
    expect(html).toContain('sandbox="allow-scripts"')
    for (const bad of ['allow-same-origin', 'allow-forms', 'allow-popups', 'allow-top-navigation', 'allow-downloads']) expect(html).not.toContain(bad)
  })
  it('src is the given URL; no srcdoc; no referrer; title names the file', () => {
    expect(html).toContain('src="https://content.example/raw/abc"')
    expect(html.toLowerCase()).not.toContain('srcdoc')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('title="設計書（アップロードされた HTML）"')
  })
  it('shows the loading status until onLoad', () => {
    expect(html).toContain('role="status"')
    expect(html).toContain('読み込み中…')
  })
  it('FrameLoading is a status', () => {
    expect(renderToStaticMarkup(<FrameLoading />)).toContain('role="status"')
  })
})

describe('ViewerHeader', () => {
  it('shows back link, name, notice V-01, download and reload', () => {
    const html = renderToStaticMarkup(<ViewerHeader {...base} />)
    expect(html).toContain('href="/folders/d1"')
    expect(html).toContain('← 設計資料')
    expect(html).toContain('設計書')
    expect(html).toContain(V01)
    expect(html).toContain('ダウンロード')
    expect(html).toContain('再読み込み')
    expect(html).not.toContain('管理者プレビュー')
  })
  it('canDownload=false: no download button and no reason', () => {
    const html = renderToStaticMarkup(<ViewerHeader {...base} canDownload={false} />)
    expect(html).not.toContain('ダウンロード')
    expect(html).toContain('再読み込み')
  })
  it('admin preview with previewNotice shows V-02 with the state name', () => {
    const html = renderToStaticMarkup(<ViewerHeader {...base} context={{ ...member, mode: 'admin_preview', previewNotice: 'suspended' }} />)
    expect(html).toContain('管理者プレビュー: 閲覧制限を無視して表示しています（現在の状態: 公開停止）。メンバーには表示されません')
  })
  it('admin preview of a public file (previewNotice null) shows no V-02', () => {
    const html = renderToStaticMarkup(<ViewerHeader {...base} context={{ ...member, mode: 'admin_preview', previewNotice: null }} />)
    expect(html).not.toContain('管理者プレビュー')
  })
  it('download error is shown in the header; pending disables the button', () => {
    const html = renderToStaticMarkup(
      <ViewerHeader {...base} downloadPending downloadError={{ code: 'ACCESS_DENIED', message: 'このファイルはダウンロードできません' }} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('このファイルはダウンロードできません')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>ダウンロード/)
  })
})
