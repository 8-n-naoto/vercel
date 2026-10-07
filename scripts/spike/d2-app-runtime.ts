// D2: app_runtime role through the pooler.  run: npx tsx scripts/spike/d2-app-runtime.ts
// Needs DB connection and the app_runtime role (HUMAN-TODO #3, #8). Read-only.
import postgres from 'postgres'
import { requireDevEnv } from './_guard'
requireDevEnv()

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10 })
try {
  const [who] = await sql`select current_user as u, current_database() as db`
  console.error(`current_user=${who?.u} database=${who?.db}`)
  try {
    await sql`select count(*) from auth.users`
    console.error('auth.users: READABLE (unexpected)')
  } catch (e) {
    console.error(`auth.users: ${e instanceof Error ? e.message : e}`) // expected: permission denied
  }
  try {
    const [c] = await sql`select count(*)::int as n from app.profiles`
    console.error(`app.profiles count=${c?.n}`)
  } catch (e) {
    console.error(`app.profiles: ${e instanceof Error ? e.message : e}`) // before WP-1.1 the table does not exist
  }
} finally {
  await sql.end()
}
