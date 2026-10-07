// Dummy, non-secret values so that getConfig() works in unit tests.
process.env.APP_ENV = 'local'
process.env.SUPABASE_URL = 'https://testref.supabase.co'
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key-0000000000'
process.env.SUPABASE_SECRET_KEY = 'test-secret-key-000000000000000'
process.env.DATABASE_URL = 'postgres://user:pass@localhost:6543/postgres'
process.env.APP_ORIGIN = 'http://localhost:3000'
process.env.CONTENT_ORIGIN = 'http://127.0.0.1:3000'
process.env.CRON_SECRET = 'test-cron-secret-00000000000000000000'
