// e2e/support/base-url.ts
// An empty or whitespace-only E2E_* value (for example `E2E_BASE_URL=` in .env.local) counts as "not set".
export function envOrDefault(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim()
  return v === '' ? fallback : v
}

export const DEFAULT_BASE_URL = 'http://localhost:3000'
export const DEFAULT_CONTENT_URL = 'http://127.0.0.1:3000'
