// Upload verification and charset detection (07 9). Pure functions.
import type { FileCharset } from '@/lib/domain'

export type VerifyFailReason = 'empty' | 'too_large' | 'not_html' | 'binary'

const CHARSET_LABELS: Record<string, FileCharset> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'unicode-1-1-utf-8': 'utf-8',
  shift_jis: 'shift_jis',
  'shift-jis': 'shift_jis',
  sjis: 'shift_jis',
  'x-sjis': 'shift_jis',
  ms_kanji: 'shift_jis',
  csshiftjis: 'shift_jis',
  'windows-31j': 'shift_jis',
  cp932: 'shift_jis',
  ms932: 'shift_jis',
  'euc-jp': 'euc-jp',
  eucjp: 'euc-jp',
  'x-euc-jp': 'euc-jp',
  cseucpkdfmtjapanese: 'euc-jp',
  'iso-2022-jp': 'iso-2022-jp',
  csiso2022jp: 'iso-2022-jp',
}
const META_CHARSET_RE = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)/i

/** BOM, then the first meta charset label, else utf-8. No statistical guessing. */
export function detectCharset(head: Uint8Array): FileCharset {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8'
  const text = Buffer.from(head).toString('latin1')
  const label = META_CHARSET_RE.exec(text)?.[1]
  if (!label) return 'utf-8'
  return CHARSET_LABELS[label.toLowerCase()] ?? 'utf-8'
}

export function verifyUpload(i: {
  size: number
  mime: string | null
  head: Uint8Array
  maxBytes: number
}): { ok: true; charset: FileCharset } | { ok: false; reason: VerifyFailReason } {
  if (i.size <= 0) return { ok: false, reason: 'empty' }
  if (i.size > i.maxBytes) return { ok: false, reason: 'too_large' }
  const mime = i.mime === null ? null : (i.mime.split(';')[0] ?? '').trim().toLowerCase()
  if (mime !== 'text/html') return { ok: false, reason: 'not_html' }
  const h = i.head
  if (h.length >= 2 && ((h[0] === 0xff && h[1] === 0xfe) || (h[0] === 0xfe && h[1] === 0xff))) return { ok: false, reason: 'binary' }
  if (h.includes(0x00)) return { ok: false, reason: 'binary' }
  return { ok: true, charset: detectCharset(h) }
}
