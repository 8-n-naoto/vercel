// WP-1.5: remove only the seed accounts / seed-folder (never a DB-wide reset). Dev project only (APP_ENV local / test).
// run: npm run seed:cleanup   (guard-env first)
import { config } from 'dotenv'
import { runCleanup } from './seed-lib'
import { withRealContext } from './seed-runtime'

config({ path: '.env.local', quiet: true })

if (process.env.APP_ENV !== 'local' && process.env.APP_ENV !== 'test') {
  console.error('seed-cleanup: APP_ENV must be "local" or "test". Refusing to run.')
  process.exit(1)
}

withRealContext(process.env, runCleanup).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`seed-cleanup: aborted: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  },
)
