// D12: create a throwaway bucket by SQL and check file_size_limit / allowed_mime_types.
// run: npx tsx scripts/spike/d12-bucket.ts          (create + check)
//      npx tsx scripts/spike/d12-bucket.ts cleanup  (remove objects and the throwaway bucket)
// Needs DATABASE_URL_MIGRATION and Supabase keys (HUMAN-TODO #3, #6). Dev project only. Touches bucket "spike-d12" only, never "files".
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { requireDevEnv } from './_guard'
requireDevEnv()

const id = 'spike-d12'
const sql = postgres(process.env.DATABASE_URL_MIGRATION!, { prepare: false, max: 1, connect_timeout: 10 })
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

async function put(path: string, body: BodyInit, type: string): Promise<string> {
  const { data, error } = await supabase.storage.from(id).createSignedUploadUrl(path)
  if (error || !data) return `no signed url: ${error?.message}`
  const res = await fetch(data.signedUrl, { method: 'PUT', headers: { 'content-type': type }, body })
  return `HTTP ${res.status}`
}

try {
  if (process.argv[2] === 'cleanup') {
    const { data } = await supabase.storage.from(id).list('')
    if (data?.length) await supabase.storage.from(id).remove(data.map((o) => o.name))
    await sql`delete from storage.buckets where id = ${id}`
    console.error('cleanup done (objects removed, bucket deleted)')
  } else {
    await sql`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (${id}, ${id}, false, 52428800, array['text/html'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types`
    const rows = await sql`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = ${id}`
    console.error('bucket row:', JSON.stringify(rows[0]))
    const big = new Blob(['<html>', 'a'.repeat(51 * 1024 * 1024), '</html>'], { type: 'text/html' })
    console.error('51MB text/html:', await put(`big-${Date.now()}.html`, big, 'text/html'), '(expect rejected)')
    console.error('text/plain:', await put(`plain-${Date.now()}.txt`, 'hello', 'text/plain'), '(expect rejected)')
    console.error('small text/html:', await put(`ok-${Date.now()}.html`, '<html></html>', 'text/html'), '(expect 200)')
    console.error('run again with "cleanup" to remove the throwaway bucket')
  }
} finally {
  await sql.end()
}
