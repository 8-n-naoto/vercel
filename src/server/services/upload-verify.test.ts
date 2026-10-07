import { describe, it, expect } from 'vitest'
import { verifyUpload, detectCharset } from './upload-verify'
import { UV_CASES, UV_X_CASES, LABEL_CASES, MAX_BYTES } from '@/tests/fixtures/upload-verify'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('verifyUpload (07 9.3)', () => {
  it('fixture has UV-01..UV-21', () => {
    expect(UV_CASES.map((c) => c.id)).toEqual(Array.from({ length: 21 }, (_, i) => `UV-${String(i + 1).padStart(2, '0')}`))
  })
  itCoversSpec07('UV', UV_CASES.map((c) => c.id), { integrationFrom: 22 })
  it.each(UV_CASES)('$id', ({ size, mime, head, expected }) => {
    expect(verifyUpload({ size, mime, head, maxBytes: MAX_BYTES })).toEqual(expected)
  })
})

describe('detectCharset', () => {
  it('defaults to utf-8 without a meta', () => {
    expect(detectCharset(new TextEncoder().encode('<p>a'))).toBe('utf-8')
  })
})

describe('verifyUpload / detectCharset boundaries outside 07 (T-018)', () => {
  it.each(UV_X_CASES)('$id', ({ size, mime, head, expected }) => {
    expect(verifyUpload({ size, mime, head, maxBytes: MAX_BYTES })).toEqual(expected)
  })
  it.each(LABEL_CASES)('$id label $label', ({ label, expected }) => {
    expect(detectCharset(new TextEncoder().encode(`<meta charset="${label}">`))).toBe(expected)
    expect(detectCharset(new TextEncoder().encode(`<meta charset="${label.toUpperCase()}">`))).toBe(expected)
  })
  // D-020: invalid sizes are rejected (fail-closed).
  const html = new TextEncoder().encode('<!doctype html><p>a')
  it('UV-X40 verifyUpload: NaN or fractional size is rejected', () => {
    expect(verifyUpload({ size: Number.NaN, mime: 'text/html', head: html, maxBytes: MAX_BYTES })).toEqual({ ok: false, reason: 'empty' })
    expect(verifyUpload({ size: 1.5, mime: 'text/html', head: html, maxBytes: MAX_BYTES })).toEqual({ ok: false, reason: 'empty' })
  })
  it('UV-X42 verifyUpload: Infinity size is too_large; non-finite maxBytes admits nothing', () => {
    expect(verifyUpload({ size: Infinity, mime: 'text/html', head: html, maxBytes: MAX_BYTES })).toEqual({ ok: false, reason: 'too_large' })
    expect(verifyUpload({ size: 10, mime: 'text/html', head: html, maxBytes: Number.NaN })).toEqual({ ok: false, reason: 'too_large' })
  })
  it.todo('UV-X41 detectCharset: a meta placed after byte 4096 should be ignored when the head is longer than 4096 bytes (07 9.2); the caller truncates today')
})
