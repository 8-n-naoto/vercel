// U2: prepared statements through the Transaction pooler.  run: npx tsx scripts/spike/u2-prepare.ts
// Needs DB connection (HUMAN-TODO #3, #7). Read-only (select only).
import postgres from 'postgres'
import { requireDevEnv } from './_guard'
requireDevEnv()

async function run(prepare: boolean) {
  const sql = postgres(process.env.DATABASE_URL!, { prepare, max: 3, connect_timeout: 10 })
  try {
    await Promise.all(Array.from({ length: 30 }, (_, i) => sql`select ${i}::int as n`))
    console.error(`prepare=${prepare}: ok`)
  } catch (e) {
    console.error(`prepare=${prepare}: ${e instanceof Error ? e.message : e}`)
  } finally {
    await sql.end()
  }
}
await run(false)
await run(true)
