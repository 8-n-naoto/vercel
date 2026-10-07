// WP-1.2: read-only verification of the dev DB against docs/05 sections 6, 8.1, 8.2, 8.3.
// run: npm run verify-db   (after the migration and 05 sections 4.2 / 4.3 / 4.4 are done; dev project only)
// Connections:
//   DATABASE_URL_MIGRATION (postgres role, session pooler): catalog checks (6.1-6.6, 8.1, 8.2). app_runtime cannot see
//                                                           other roles' grants in information_schema.
//   DATABASE_URL (app_runtime): behaviour checks (8.3), each run in a transaction that is always rolled back.
// Never prints connection strings, keys, or row data other than object names.
import postgres from 'postgres'
import { EXPECTED_COLUMNS, EXPECTED_COLUMN_TOTAL } from '../../src/tests/fixtures/schema-names'
import { requireDevEnv } from '../spike/_guard'
import { EXPECTED_DB_OBJECTS } from './verify-db-expected'

requireDevEnv()

const TABLES = Object.keys(EXPECTED_COLUMNS).sort()
let failures = 0

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.error(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${detail}` : ''}`)
}

function setDiff(expected: string[], actual: string[]): string {
  const e = new Set(expected)
  const a = new Set(actual)
  const missing = expected.filter((x) => !a.has(x))
  const extra = actual.filter((x) => !e.has(x))
  return `missing=[${missing.join(',')}] extra=[${extra.join(',')}]`
}

function sameSet(expected: string[], actual: string[]): boolean {
  return expected.length === actual.length && setDiff(expected, actual) === 'missing=[] extra=[]'
}

async function catalogChecks(sql: postgres.Sql): Promise<void> {
  // 6.1 RLS enabled on all 9 tables
  const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname`
  const rlsNames = rls.map((r) => r.relname)
  check('6.1 app has the 9 expected tables', sameSet(TABLES, rlsNames), setDiff(TABLES, rlsNames))
  check(
    '6.1 RLS enabled on every table',
    rls.length > 0 && rls.every((r) => r.relrowsecurity),
    rls.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(','),
  )

  // 6.2 policies
  const pol = await sql<
    { tablename: string; policyname: string; roles: string; cmd: string; qual: string | null; with_check: string | null }[]
  >`SELECT tablename, policyname, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'app' ORDER BY tablename`
  check('6.2 exactly 9 policies, one per table', sameSet(TABLES, pol.map((p) => p.tablename)), `count=${pol.length}`)
  check(
    '6.2 all policies are app_runtime_all / {app_runtime} / ALL / true / true',
    pol.every(
      (p) => p.policyname === 'app_runtime_all' && p.roles === '{app_runtime}' && p.cmd === 'ALL' && p.qual === 'true' && p.with_check === 'true',
    ),
    pol.map((p) => `${p.tablename}:${p.policyname}:${p.roles}:${p.cmd}:${p.qual}:${p.with_check}`).join(' | '),
  )

  // 6.3 no privileges for Data API roles and PUBLIC
  const grants = await sql<{ grantee: string; table_name: string }[]>`
    SELECT grantee, table_name FROM information_schema.role_table_grants
    WHERE table_schema = 'app' AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')`
  check('6.3 no table grants to anon / authenticated / service_role / PUBLIC', grants.length === 0, `${grants.length} grants`)
  const usage = await sql<{ rolname: string; usage: boolean }[]>`
    SELECT r.rolname, has_schema_privilege(r.rolname, 'app', 'USAGE') AS usage FROM pg_roles r
    WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'app_runtime')`
  const usageMap: Record<string, boolean> = Object.fromEntries(usage.map((u) => [u.rolname, u.usage]))
  check(
    '6.3 schema USAGE only for app_runtime',
    usageMap['app_runtime'] === true && usageMap['anon'] === false && usageMap['authenticated'] === false && usageMap['service_role'] === false,
    JSON.stringify(usageMap),
  )

  // 6.4 app_runtime attributes and privileges
  const [role] = await sql<
    {
      rolcanlogin: boolean
      rolsuper: boolean
      rolinherit: boolean
      rolcreaterole: boolean
      rolcreatedb: boolean
      rolbypassrls: boolean
      rolconfig: string[] | null
    }[]
  >`SELECT rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls, rolconfig FROM pg_roles WHERE rolname = 'app_runtime'`
  check('6.4 role app_runtime exists', role !== undefined)
  if (role) {
    check('6.4 app_runtime can log in (after 05 4.2)', role.rolcanlogin === true)
    check(
      '6.4 app_runtime has no super / createrole / createdb / bypassrls / inherit',
      !role.rolsuper && !role.rolcreaterole && !role.rolcreatedb && !role.rolbypassrls && !role.rolinherit,
    )
    const cfg = role.rolconfig ?? []
    const wanted = ['statement_timeout=15s', 'lock_timeout=5s', 'idle_in_transaction_session_timeout=15s']
    const missing = wanted.filter((w) => !cfg.includes(w))
    check('6.4 rolconfig has the three timeouts', missing.length === 0, `missing=[${missing.join(',')}]`)
    check(
      '6.4 rolconfig search_path is app, pg_catalog',
      cfg.some((c) => /^search_path=("?app"?, ?"?pg_catalog"?)$/.test(c)),
      cfg.filter((c) => c.startsWith('search_path')).join(','),
    )
  }
  const priv = await sql<
    { relname: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean; refs: boolean; trig: boolean }[]
  >`SELECT c.relname,
      has_table_privilege('app_runtime', c.oid, 'SELECT') AS sel, has_table_privilege('app_runtime', c.oid, 'INSERT') AS ins,
      has_table_privilege('app_runtime', c.oid, 'UPDATE') AS upd, has_table_privilege('app_runtime', c.oid, 'DELETE') AS del,
      has_table_privilege('app_runtime', c.oid, 'TRUNCATE') AS trunc, has_table_privilege('app_runtime', c.oid, 'REFERENCES') AS refs,
      has_table_privilege('app_runtime', c.oid, 'TRIGGER') AS trig
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname`
  const okPriv = (p: (typeof priv)[number]): boolean => p.sel && p.ins && p.upd && p.del && !p.trunc && !p.refs && !p.trig
  check(
    '6.4 app_runtime: SELECT/INSERT/UPDATE/DELETE only (9 tables)',
    priv.length === 9 && priv.every(okPriv),
    priv.filter((p) => !okPriv(p)).map((p) => p.relname).join(','),
  )
  const [fn] = await sql<{ app_runtime_exec: boolean; anon_exec: boolean }[]>`
    SELECT has_function_privilege('app_runtime', 'app.set_updated_at()', 'EXECUTE') AS app_runtime_exec,
           has_function_privilege('anon', 'app.set_updated_at()', 'EXECUTE') AS anon_exec`
  check('6.4 set_updated_at(): app_runtime yes, anon no', fn?.app_runtime_exec === true && fn?.anon_exec === false, JSON.stringify(fn))

  // 6.5 triggers
  const trg = await sql<{ event_object_table: string; action_timing: string; event_manipulation: string }[]>`
    SELECT event_object_table, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema = 'app' ORDER BY 1`
  check(
    '6.5 four BEFORE UPDATE triggers (files, folders, profiles, share_links)',
    sameSet(['files', 'folders', 'profiles', 'share_links'], trg.map((t) => t.event_object_table)) &&
      trg.every((t) => t.action_timing === 'BEFORE' && t.event_manipulation === 'UPDATE'),
    trg.map((t) => t.event_object_table).join(','),
  )

  // 6.6 storage bucket
  const [bucket] = await sql<{ public: boolean; file_size_limit: string | number | null; allowed_mime_types: string[] | null }[]>`
    SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'files'`
  check(
    '6.6 bucket "files" is private, 52428800 bytes, text/html only',
    bucket !== undefined &&
      bucket.public === false &&
      Number(bucket.file_size_limit) === 52428800 &&
      JSON.stringify(bucket.allowed_mime_types) === JSON.stringify(['text/html']),
    bucket ? `public=${bucket.public} limit=${bucket.file_size_limit} mime=${JSON.stringify(bucket.allowed_mime_types)}` : 'bucket missing',
  )
  const [sp] = await sql<{ policies: number }[]>`
    SELECT count(*)::int AS policies FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND (qual LIKE '%''files''%' OR with_check LIKE '%''files''%')`
  check('6.6 no storage policy references bucket "files"', sp?.policies === 0, `policies=${sp?.policies}`)

  // 8.1 columns
  const cols = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'app' ORDER BY table_name, ordinal_position`
  check(`8.1 total columns = ${EXPECTED_COLUMN_TOTAL}`, cols.length === EXPECTED_COLUMN_TOTAL, `actual=${cols.length}`)
  for (const t of TABLES) {
    const actual = cols.filter((c) => c.table_name === t).map((c) => c.column_name)
    const expected = EXPECTED_COLUMNS[t] ?? []
    // Order matters: ordinal_position order must equal the 05 listing.
    check(`8.1 columns of ${t} (${expected.length}, in order)`, JSON.stringify(actual) === JSON.stringify(expected), setDiff(expected, actual))
  }

  // 8.2 constraints and indexes (NOT NULL constraints, contype 'n' on PG 18, are excluded)
  const cons = await sql<{ tbl: string; conname: string; contype: string }[]>`
    SELECT conrelid::regclass::text AS tbl, conname, contype::text AS contype FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace AND contype IN ('p','f','u','c') ORDER BY 1, 2`
  const idxs = await sql<{ tablename: string; indexname: string }[]>`
    SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'app' ORDER BY 1, 2`
  for (const t of TABLES) {
    const exp = EXPECTED_DB_OBJECTS[t]
    if (!exp) {
      check(`8.2 expected names exist for ${t}`, false, 'verify-db-expected.ts has no entry')
      continue
    }
    const actualCons = cons.filter((c) => c.tbl === t || c.tbl === `app.${t}`).map((c) => `${c.contype}:${c.conname}`)
    check(`8.2 constraints of ${t} (${exp.constraints.length})`, sameSet(exp.constraints, actualCons), setDiff(exp.constraints, actualCons))
    const keyIdx = exp.constraints.filter((c) => c.startsWith('p:') || c.startsWith('u:')).map((c) => c.slice(2))
    const expectedIdx = [...keyIdx, ...exp.indexes]
    const actualIdx = idxs.filter((i) => i.tablename === t).map((i) => i.indexname)
    check(`8.2 indexes of ${t} (${expectedIdx.length}, including pkey/key)`, sameSet(expectedIdx, actualIdx), setDiff(expectedIdx, actualIdx))
  }
}

class Rollback extends Error {}

/** Runs `body` in a transaction that is always rolled back. Returns the SQLSTATE raised by `body`, or null if it succeeded. */
async function expectSqlState(sql: postgres.Sql, body: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<string | null> {
  let state: string | null = null
  try {
    await sql.begin(async (tx) => {
      try {
        await body(tx)
      } catch (e) {
        state = (e as { code?: string }).code ?? 'unknown'
      }
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  return state
}

async function behaviourChecks(sql: postgres.Sql): Promise<void> {
  const [who] = await sql<{ u: string }[]>`SELECT current_user AS u`
  check('8.3 DATABASE_URL connects as app_runtime', who?.u === 'app_runtime', `current_user=${who?.u}`)

  check(
    '8.3(a) legacy via value rejected with 23514',
    (await expectSqlState(
      sql,
      (tx) => tx`INSERT INTO app.access_logs (file_id, folder_id, via, purpose, user_id, result, ticket_expires_at)
        VALUES (gen_random_uuid(), gen_random_uuid(), 'owner_preview', 'view', gen_random_uuid(), 'granted', now())`,
    )) === '23514',
  )
  check('8.3(b) DDL rejected with 42501', (await expectSqlState(sql, (tx) => tx`CREATE TABLE app.probe (id int)`)) === '42501')
  check('8.3(c) auth.users not readable (42501)', (await expectSqlState(sql, (tx) => tx`SELECT count(*) FROM auth.users`)) === '42501')
  check('8.3(d) TRUNCATE rejected with 42501', (await expectSqlState(sql, (tx) => tx`TRUNCATE app.rate_limits`)) === '42501')

  // (e) updated_at trigger. Needs an existing profiles row; skipped (not failed) when the table is empty. Rolled back.
  const [p] = await sql<{ id: string }[]>`SELECT id FROM app.profiles LIMIT 1`
  if (!p) {
    console.error('SKIP  8.3(e) updated_at trigger: app.profiles is empty (create the first admin, 05 section 7, and re-run)')
    return
  }
  let changed = false
  try {
    await sql.begin(async (tx) => {
      const [before] = await tx<{ updated_at: Date }[]>`SELECT updated_at FROM app.profiles WHERE id = ${p.id}`
      await tx`UPDATE app.profiles SET display_name = display_name WHERE id = ${p.id}`
      const [after] = await tx<{ updated_at: Date }[]>`SELECT updated_at FROM app.profiles WHERE id = ${p.id}`
      changed = !!before && !!after && after.updated_at.getTime() > before.updated_at.getTime()
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  check('8.3(e) updated_at is advanced by the trigger', changed)
}

/** 6.7 / 6.8: external checks with the publishable key. Only status codes are printed. */
async function externalChecks(): Promise<void> {
  const base = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!base || !key) {
    console.error('SKIP  6.7 / 6.8 external checks: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set')
    return
  }
  const rest = await fetch(`${base}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: key, 'Accept-Profile': 'app' } })
  check('6.7 Data API does not expose app (non-2xx)', !rest.ok, `status=${rest.status}`)
  const up = await fetch(`${base}/storage/v1/object/files/probe.html`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'text/html' },
    body: '<p>x</p>',
  })
  check('6.8 anonymous Storage upload rejected (non-2xx)', !up.ok, `status=${up.status}`)
  const su = await fetch(`${base}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'probe@example.invalid', password: 'probe-password-123456' }),
  })
  const body = (await su.text()).toLowerCase()
  check('6.8 public sign-up refused', !su.ok && (body.includes('signup_disabled') || body.includes('signups not allowed')), `status=${su.status}`)
  console.error('NOTE  6.8: confirm in Authentication -> Users that no probe@example.invalid user exists')
}

async function main(): Promise<void> {
  const migrationUrl = process.env.DATABASE_URL_MIGRATION
  const runtimeUrl = process.env.DATABASE_URL
  if (!migrationUrl || !runtimeUrl) {
    console.error('verify-db: DATABASE_URL and DATABASE_URL_MIGRATION are required')
    process.exit(1)
  }
  const mig = postgres(migrationUrl, { prepare: false, max: 1, connect_timeout: 10 })
  const run = postgres(runtimeUrl, { prepare: false, max: 1, connect_timeout: 10 })
  try {
    await catalogChecks(mig)
    await behaviourChecks(run)
    await externalChecks()
  } finally {
    await mig.end()
    await run.end()
  }
  console.error(failures === 0 ? 'verify-db: all checks passed' : `verify-db: ${failures} check(s) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`verify-db: aborted: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
