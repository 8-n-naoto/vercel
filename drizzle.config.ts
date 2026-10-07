import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

const url = process.env.DATABASE_URL_MIGRATION
if (!url) {
  throw new Error('DATABASE_URL_MIGRATION is required (Session pooler, port 5432)')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['app'],
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
