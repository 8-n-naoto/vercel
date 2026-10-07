// WP-1.5: create the 3 verification accounts + 1 folder + 1 member. Dev project only (APP_ENV local / test).
// run: npm run seed   (guard-env first; needs SEED_PASSWORD in .env.local)
import { config } from 'dotenv'
import { runSeed } from './seed-lib'
import { withRealContext } from './seed-runtime'

config({ path: '.env.local', quiet: true })

// Re-check APP_ENV here as well: this file may be run directly with tsx, bypassing guard-env.
if (process.env.APP_ENV !== 'local' && process.env.APP_ENV !== 'test') {
  console.error('seed: APP_ENV must be "local" or "test". Refusing to run.')
  process.exit(1)
}

withRealContext(process.env, runSeed).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`seed: aborted: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  },
)
