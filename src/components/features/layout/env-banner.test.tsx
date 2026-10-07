// L01-1 (production side): the banner is not rendered for production, and shows B-01 / B-02 otherwise (08 3.5).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EnvBanner, envBannerLabel } from './env-banner'

describe('envBannerLabel (08 3.5 / 9.4 B-01, B-02)', () => {
  it('local -> ローカル環境', () => expect(envBannerLabel('local')).toBe('ローカル環境'))
  it('test -> テスト環境', () => expect(envBannerLabel('test')).toBe('テスト環境'))
  it('production -> null (nothing is rendered)', () => expect(envBannerLabel('production')).toBeNull())
})

describe('EnvBanner', () => {
  it('renders the label in a note with aria-label 環境', () => {
    const html = renderToStaticMarkup(<EnvBanner label="テスト環境" />)
    expect(html).toContain('role="note"')
    expect(html).toContain('aria-label="環境"')
    expect(html).toContain('テスト環境')
    expect(html).toContain('h-6')
  })
  it('renders no element at all for null (no empty band in production)', () => {
    expect(renderToStaticMarkup(<EnvBanner label={envBannerLabel('production')} />)).toBe('')
  })
  it('is not sticky / fixed', () => {
    const html = renderToStaticMarkup(<EnvBanner label="ローカル環境" />)
    expect(html).not.toMatch(/sticky|fixed/)
  })
})
