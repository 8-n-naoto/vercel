// S15-2: error.tsx shows the digest as the ID and nothing else of the exception (08 5.15).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ErrorPage from './error'
import GlobalError from './global-error'
import NotFound from './not-found'

const noop = () => {}

describe('error.tsx', () => {
  it('shows エラーが発生しました（ID: {digest}） and a retry button', () => {
    const e = Object.assign(new Error('relation "app.files" does not exist'), { digest: '1234567890' })
    const html = renderToStaticMarkup(<ErrorPage error={e} reset={noop} />)
    expect(html).toContain('エラーが発生しました（ID: 1234567890）')
    expect(html).toContain('再試行')
    expect(html).toContain('フォルダ一覧へ')
  })
  it('shows ID: - without a digest', () => {
    expect(renderToStaticMarkup(<ErrorPage error={new Error('x')} reset={noop} />)).toContain('エラーが発生しました（ID: -）')
  })
  it('never shows the exception message or stack', () => {
    const e = Object.assign(new Error('SELECT * FROM app.users failed'), { digest: 'd1' })
    const html = renderToStaticMarkup(<ErrorPage error={e} reset={noop} />)
    expect(html).not.toContain('SELECT')
    expect(html).not.toContain('app.users')
    expect(html).not.toContain('at ')
  })
})

describe('global-error.tsx', () => {
  it('renders its own html element with the digest', () => {
    const html = renderToStaticMarkup(<GlobalError error={Object.assign(new Error('boom'), { digest: 'g9' })} reset={noop} />)
    expect(html.startsWith('<html lang="ja">')).toBe(true)
    expect(html).toContain('エラーが発生しました（ID: g9）')
    expect(html).not.toContain('boom')
  })
})

describe('not-found.tsx', () => {
  it('shows E-01 and the folder list link', () => {
    const html = renderToStaticMarkup(<NotFound />)
    expect(html).toContain('ページが見つかりません')
    expect(html).toContain('href="/folders"')
  })
})
