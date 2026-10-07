// D1 / D6 / U8: create a signed upload URL and report the token lifetime.  run: npx tsx scripts/spike/d1-signed-upload.ts
// Needs Supabase (HUMAN-TODO #3, #6, #7). Writes the signed URL to .spike-signed-url.tmp (gitignored); never prints it.
// Then follow 04 section 11.2 D1 for the curl cases (A: no apikey, C: with apikey, 2nd PUT, CORS, TUS). Use a fresh URL per case.
import { writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { requireDevEnv } from './_guard'
requireDevEnv()

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const bucket = process.env.STORAGE_BUCKET ?? 'files'
const path = `spike/d1-${Date.now()}.html`
const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path)
if (error || !data) throw error ?? new Error('no data')
const payload = JSON.parse(Buffer.from(data.token.split('.')[1]!, 'base64url').toString()) as { exp?: number; iat?: number }
console.error('path:', data.path)
console.error('token exp - iat (seconds):', payload.exp && payload.iat ? payload.exp - payload.iat : '(no exp/iat)') // D6
await writeFile('.spike-signed-url.tmp', data.signedUrl)
console.error('signed URL written to .spike-signed-url.tmp (move to _archive/ after use)')
