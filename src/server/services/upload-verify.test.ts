import { describe, it, expect } from 'vitest'
import { verifyUpload, detectCharset } from './upload-verify'
import { UV_CASES, MAX_BYTES } from '@/tests/fixtures/upload-verify'

describe('verifyUpload (07 9.3)', () => {
  it('fixture has UV-01..UV-21', () => {
    expect(UV_CASES.map((c) => c.id)).toEqual(Array.from({ length: 21 }, (_, i) => `UV-${String(i + 1).padStart(2, '0')}`))
  })
  it.each(UV_CASES)('$id', ({ size, mime, head, expected }) => {
    expect(verifyUpload({ size, mime, head, maxBytes: MAX_BYTES })).toEqual(expected)
  })
})

describe('detectCharset', () => {
  it('defaults to utf-8 without a meta', () => {
    expect(detectCharset(new TextEncoder().encode('<p>a'))).toBe('utf-8')
  })
})
