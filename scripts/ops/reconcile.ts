// T-052 (runbook 4): read-only comparison of Storage objects and app.files rows. Dev/test project only.
// run: npm run ops:reconcile [-- --json]
// Reads: app.files (id, storage_path, status, purged_at) with DATABASE_URL (app_runtime) in a READ ONLY transaction.
//        Storage object names via list() only (no download, no signed URL, no write).
// Output: category, file id, storage path and counts only. Never prints display names, emails, keys or connection strings.
// Categories:
//   orphan            object exists, no files row references its path (or the row is deleted and already purged)
//   missing_object    files.status = 'active' but no object at storage_path
//   unpurged_deleted  files.status = 'deleted' and purged_at IS NULL (object_exists tells whether the object is still there)
// Exit codes: 0 = no difference, 1 = difference found, 2 = error (connection/list failure). guard-env rejects other targets.
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { requireDevEnv } from '../spike/_guard'

requireDevEnv()

const PAGE_LIMIT = 1000 // Storage list() maximum per call
const MAX_PAGES = 100 // safety cap: 100,000 entries per prefix (free tier holds far fewer)

type FileRow = { id: string; storage_path: string; status: string; purged_at: Date | null }
type Finding = { category: 'orphan' | 'missing_object' | 'unpurged_deleted'; file_id: string | null; path: string; object_exists?: boolean }

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`reconcile: ${name} is not set`)
    process.exit(2)
  }
  return v
}

async function listAllPaths(): Promise<{ paths: Set<string>; calls: number }> {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const bucket = client.storage.from(process.env.STORAGE_BUCKET || 'files')
  const paths = new Set<string>()
  let calls = 0

  async function walk(prefix: string): Promise<void> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await bucket.list(prefix, { limit: PAGE_LIMIT, offset: page * PAGE_LIMIT })
      calls++
      if (error || !data) throw new Error('storage list failed')
      for (const o of data) {
        const path = prefix === '' ? o.name : `${prefix}/${o.name}`
        if (o.id === null) await walk(path) // folder placeholder
        else paths.add(path)
      }
      if (data.length < PAGE_LIMIT) return
    }
    throw new Error('storage list exceeded the page cap')
  }

  await walk('')
  return { paths, calls }
}

async function main(): Promise<number> {
  const asJson = process.argv.includes('--json')
  const sql = postgres(required('DATABASE_URL'), { max: 1, prepare: false })
  let rows: FileRow[]
  try {
    rows = await sql.begin('read only', async (tx) => {
      return await tx<FileRow[]>`SELECT id, storage_path, status, purged_at FROM app.files`
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
  const { paths: objects, calls } = await listAllPaths()

  const findings: Finding[] = []
  const rowByPath = new Map(rows.map((r) => [r.storage_path, r]))
  for (const p of objects) {
    const r = rowByPath.get(p)
    if (!r || (r.status === 'deleted' && r.purged_at !== null)) findings.push({ category: 'orphan', file_id: r?.id ?? null, path: p })
  }
  for (const r of rows) {
    if (r.status === 'active' && !objects.has(r.storage_path)) findings.push({ category: 'missing_object', file_id: r.id, path: r.storage_path })
    if (r.status === 'deleted' && r.purged_at === null)
      findings.push({ category: 'unpurged_deleted', file_id: r.id, path: r.storage_path, object_exists: objects.has(r.storage_path) })
  }

  const counts = {
    orphan: findings.filter((f) => f.category === 'orphan').length,
    missing_object: findings.filter((f) => f.category === 'missing_object').length,
    unpurged_deleted: findings.filter((f) => f.category === 'unpurged_deleted').length,
  }
  const summary = { db_rows: rows.length, storage_objects: objects.size, list_calls: calls, ...counts }

  if (asJson) {
    console.log(JSON.stringify({ summary, findings }))
  } else {
    console.log(`summary: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    for (const f of findings) {
      console.log(`${f.category}\tfile_id=${f.file_id ?? '-'}\tpath=${f.path}${f.object_exists === undefined ? '' : `\tobject_exists=${f.object_exists}`}`)
    }
    console.log(findings.length === 0 ? 'result: no difference' : `result: ${findings.length} difference(s)`)
  }
  return findings.length === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    // Error class name only: SDK / driver messages can contain hosts or hints about credentials.
    console.error(`reconcile: failed (${e instanceof Error ? e.name : 'unknown'})`)
    process.exit(2)
  },
)
