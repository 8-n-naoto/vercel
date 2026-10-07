// D14: does supabase-js storage.info() exist and what does it return, and does Range give 206? (04 11.2 D14, 06 7.7)
// run: npx tsx scripts/spike/d14-storage.ts
// Needs SUPABASE_URL / SUPABASE_SECRET_KEY (HUMAN-TODO #3, #6). Dev project only. Touches only spike/<uuid>/ in the files bucket.
// Prints findings only (never URLs, tokens or keys). NOT RUN when written (T-031).
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { requireDevEnv } from './_guard'
requireDevEnv()

const bucketName = process.env.STORAGE_BUCKET ?? 'files'
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const bucket = supabase.storage.from(bucketName)
const dir = `spike/${randomUUID()}`
const path = `${dir}/d14.html`
const body = '<!doctype html>' + 'a'.repeat(8000)

try {
  const up = await bucket.createSignedUploadUrl(path)
  if (up.error || !up.data) throw new Error('createSignedUploadUrl failed')
  const put = await fetch(up.data.signedUrl, { method: 'PUT', headers: { 'content-type': 'text/html' }, body })
  console.error('PUT status:', put.status, '(expect 200)')

  // (1) info()
  const hasInfo = typeof (bucket as { info?: unknown }).info === 'function'
  console.error('info() exists:', hasInfo)
  if (hasInfo) {
    const info = await bucket.info(path)
    console.error('info error:', info.error ? 'yes' : 'no', '| keys:', info.data ? Object.keys(info.data).join(',') : '-')
    console.error('info size/contentType:', info.data?.size, info.data?.contentType)
    const miss = await bucket.info(`${dir}/missing.html`)
    console.error('info on missing object: error =', miss.error ? 'yes' : 'no', '(adapter falls back to list on error)')
  }
  const listed = await bucket.list(dir, { search: 'd14.html', limit: 100 })
  const hit = listed.data?.find((o) => o.name === 'd14.html')
  console.error('list fallback metadata size/mimetype:', hit?.metadata?.size, hit?.metadata?.mimetype)

  // (2) Range
  const signed = await bucket.createSignedUrl(path, 60)
  if (signed.error || !signed.data) throw new Error('createSignedUrl failed')
  const res = await fetch(signed.data.signedUrl, { headers: { Range: 'bytes=0-4095' } })
  const buf = new Uint8Array(await res.arrayBuffer())
  console.error('Range status:', res.status, '(206 = honored) | Content-Range:', res.headers.get('content-range'), '| bytes:', buf.length)
  console.error(res.status === 206 ? 'verdict: Range works' : 'verdict: Range ignored, adapter truncates and cancels the stream')
} finally {
  const r = await bucket.remove([path])
  console.error('cleanup:', r.error ? 'failed (remove spike/ objects by hand)' : 'done')
}
