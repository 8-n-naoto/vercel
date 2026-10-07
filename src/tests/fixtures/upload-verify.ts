// Test vectors for verifyUpload / detectCharset. Copied one row per case from 07 9.3 (UV-01..UV-21, IDs preserved). maxBytes = 52,428,800.
import type { VerifyFailReason } from '@/server/services/upload-verify'
import type { FileCharset } from '@/lib/domain'

export const MAX_BYTES = 52_428_800
const enc = new TextEncoder()
const ascii = (s: string): Uint8Array => enc.encode(s)
const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b)
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const doc = ascii('<!doctype html><p>a')

export type UvExpected = { ok: true; charset: FileCharset } | { ok: false; reason: VerifyFailReason }
export interface UvCase { id: string; size: number; mime: string | null; head: Uint8Array; expected: UvExpected }

const ok = (charset: FileCharset): UvExpected => ({ ok: true, charset })
const fail = (reason: VerifyFailReason): UvExpected => ({ ok: false, reason })
const u = (id: string, size: number, mime: string | null, head: Uint8Array, expected: UvExpected): UvCase => ({ id, size, mime, head, expected })
const html = (id: string, head: Uint8Array, expected: UvExpected): UvCase => u(id, 100, 'text/html', head, expected)

export const UV_CASES: UvCase[] = [
  u('UV-01', 0, 'text/plain', new Uint8Array(0), fail('empty')),
  u('UV-02', 52_428_800, 'text/html', doc, ok('utf-8')),
  u('UV-03', 52_428_801, 'text/html', doc, fail('too_large')),
  u('UV-04', 100, 'text/html; charset=utf-8', doc, ok('utf-8')),
  u('UV-05', 100, 'TEXT/HTML', doc, ok('utf-8')),
  u('UV-06', 100, 'text/plain', doc, fail('not_html')),
  u('UV-07', 100, 'application/octet-stream', doc, fail('not_html')),
  u('UV-08', 100, null, doc, fail('not_html')),
  html('UV-09', cat(ascii('<p>a'), bytes(0x00)), fail('binary')),
  u('UV-10', 4096, 'text/html', cat(ascii('a'.repeat(4095)), bytes(0x00)), fail('binary')),
  html('UV-11', bytes(0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00), fail('binary')),
  html('UV-12', cat(bytes(0xef, 0xbb, 0xbf), enc.encode('<p>あ')), ok('utf-8')),
  html('UV-13', ascii('<meta charset="Shift_JIS">'), ok('shift_jis')),
  html('UV-14', ascii('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=x-sjis">'), ok('shift_jis')),
  html('UV-15', ascii('<meta charset=euc-jp>'), ok('euc-jp')),
  html('UV-16', ascii('<meta http-equiv="content-type" content="text/html;charset=ISO-2022-JP">'), ok('iso-2022-jp')),
  html('UV-17', ascii('<meta charset="windows-1252">'), ok('utf-8')),
  html('UV-18', ascii('<meta charset="utf-8"><meta charset="shift_jis">'), ok('utf-8')),
  html('UV-19', ascii('<title>charset=shift_jis</title>'), ok('utf-8')),
  html('UV-20', cat(bytes(0x82, 0xa0), ascii('<meta charset="cp932">')), ok('shift_jis')),
  html('UV-21', ascii('<meta name="viewport" content="width=device-width">'), ok('utf-8')),
]

// Additions outside 07 (T-018, F-003 proposal 6). X-marked IDs never collide with 07 IDs.
export const UV_X_CASES: UvCase[] = [
  html('UV-X01', bytes(0xfe, 0xff, 0x3c, 0x70), fail('binary')), // UTF-16BE BOM without a NUL byte
  html('UV-X02', cat(bytes(0xef, 0xbb, 0xbf), ascii('<meta charset="shift_jis">')), ok('utf-8')), // BOM wins over meta
  html('UV-X03', ascii('<p>' + ' '.repeat(4000) + '<meta charset="shift_j'), ok('utf-8')), // truncated label is unknown
  u('UV-X04', -1, 'text/html', doc, fail('empty')),
  u('UV-X05', Number.POSITIVE_INFINITY, 'text/html', doc, fail('too_large')),
  u('UV-X06', 100, '', doc, fail('not_html')),
  u('UV-X07', 100, 'text/html ;charset=utf-8', doc, ok('utf-8')),
  u('UV-X08', 100, ' text/html', doc, ok('utf-8')),
  u('UV-X09', 100, 'text/htmlx', doc, fail('not_html')),
  u('UV-X10', 100, 'application/xhtml+xml', doc, fail('not_html')),
  u('UV-X11', 1, 'text/html', ascii('a'), ok('utf-8')), // 1-byte head
  u('UV-X12', 100, 'text/html', new Uint8Array(0), ok('utf-8')), // empty head with a positive size
  u('UV-X13', 100, 'text/html', bytes(0xff), ok('utf-8')), // lone 0xFF is not a BOM
  html('UV-X14', ascii('<meta charset="UTF-8">'), ok('utf-8')),
  html('UV-X15', ascii("<meta charset='Shift_JIS'>"), ok('shift_jis')),
]

// Every label of CHARSET_LABELS (18) and its normalized value.
export const LABEL_CASES: { id: string; label: string; expected: FileCharset }[] = [
  ['utf-8', 'utf-8'], ['utf8', 'utf-8'], ['unicode-1-1-utf-8', 'utf-8'],
  ['shift_jis', 'shift_jis'], ['shift-jis', 'shift_jis'], ['sjis', 'shift_jis'], ['x-sjis', 'shift_jis'], ['ms_kanji', 'shift_jis'],
  ['csshiftjis', 'shift_jis'], ['windows-31j', 'shift_jis'], ['cp932', 'shift_jis'], ['ms932', 'shift_jis'],
  ['euc-jp', 'euc-jp'], ['eucjp', 'euc-jp'], ['x-euc-jp', 'euc-jp'], ['cseucpkdfmtjapanese', 'euc-jp'],
  ['iso-2022-jp', 'iso-2022-jp'], ['csiso2022jp', 'iso-2022-jp'],
].map(([label, expected], i) => ({ id: 'UV-X' + String(16 + i), label: label as string, expected: expected as FileCharset }))
