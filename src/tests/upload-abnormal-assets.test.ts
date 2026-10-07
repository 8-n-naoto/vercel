// WP-4.7 (T-040): the abnormal-upload materials from e2e/assets run through the real verifyUpload (no DB, no Storage).
// 02 10 phase 3 (2) server layer (size boundary) and the three abnormal kinds: destructive HTML, huge HTML, charset variants.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectCharset, verifyUpload } from '@/server/services/upload-verify'

const MAX = 52_428_800
const asset = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(process.cwd(), 'e2e', 'assets', name)))
const head = (b: Uint8Array): Uint8Array => b.slice(0, 4096)
const verify = (name: string) => {
  const b = asset(name)
  return verifyUpload({ size: b.length, mime: 'text/html', head: head(b), maxBytes: MAX })
}

describe('charset variants (07 9.3: BOM / Shift_JIS / EUC-JP / ISO-2022-JP)', () => {
  it.each([
    ['charset-utf8-bom.html', 'utf-8'],
    ['charset-shift_jis.html', 'shift_jis'],
    ['charset-euc-jp.html', 'euc-jp'],
    ['charset-iso-2022-jp.html', 'iso-2022-jp'],
  ])('%s -> %s and passes verification (the charset is only a hint, not a rejection reason)', (name, charset) => {
    expect(verify(name)).toEqual({ ok: true, charset })
  })
  it('UTF-16 (BOM FF FE / FE FF, or NUL bytes) is rejected as binary, never as a charset', () => {
    for (const h of [
      [0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00],
      [0xfe, 0xff, 0x00, 0x3c, 0x00, 0x70],
      [0x3c, 0x00, 0x70, 0x00],
    ]) {
      expect(verifyUpload({ size: h.length, mime: 'text/html', head: Uint8Array.from(h), maxBytes: MAX })).toEqual({ ok: false, reason: 'binary' })
    }
  })
})

describe('destructive HTML is not rejected at upload (isolation is the delivery side, WP-5.5)', () => {
  it('probe.html (external requests, cookie, top navigation, form submit, window.open) passes verification as utf-8', () => {
    const b = asset('probe.html')
    expect(Buffer.from(b).toString('utf-8')).toContain('<script>')
    expect(verify('probe.html')).toEqual({ ok: true, charset: 'utf-8' })
    expect(detectCharset(head(b))).toBe('utf-8')
  })
})

describe('size boundary on the server layer (the same rule as the startUpload schema and finalizeUpload)', () => {
  const doc = new TextEncoder().encode('<!doctype html><p>a')
  it('exactly 50 MB passes; 50 MB + 1 byte is too_large; 0 is empty', () => {
    expect(verifyUpload({ size: MAX, mime: 'text/html', head: doc, maxBytes: MAX })).toEqual({ ok: true, charset: 'utf-8' })
    expect(verifyUpload({ size: MAX + 1, mime: 'text/html', head: doc, maxBytes: MAX })).toEqual({ ok: false, reason: 'too_large' })
    expect(verifyUpload({ size: 0, mime: 'text/html', head: new Uint8Array(0), maxBytes: MAX })).toEqual({ ok: false, reason: 'empty' })
  })
  it('the 50 MB assets on disk (gitignored; checked only when generated) are exactly at / one byte over the limit', () => {
    for (const [name, size] of [
      ['large-max.html', MAX],
      ['large-over-limit.html', MAX + 1],
    ] as const) {
      try {
        expect(statSync(path.join(process.cwd(), 'e2e', 'assets', name)).size).toBe(size)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
  })
})
