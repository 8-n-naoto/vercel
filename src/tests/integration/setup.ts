// Integration test setup (04 4.6). Loads .env.local (values are never printed) and refuses to run against anything but dev/test.
import { guardErrors } from '@/lib/env-guard'
import { describeTarget, getConfig } from '@/server/config'

try {
  process.loadEnvFile('.env.local')
} catch {
  // .env.local may be absent when the variables are already in the environment; getConfig() below fails if they are missing.
}

const errors = guardErrors(process.env)
if (errors.length > 0) {
  throw new Error(`Integration tests refused:\n${errors.join('\n')}`)
}

const target = describeTarget(getConfig()) // throws (names only) on invalid configuration
if (target.env === 'production') {
  throw new Error('Integration tests refused: APP_ENV=production')
}
