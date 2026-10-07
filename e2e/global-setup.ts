// e2e/global-setup.ts
export default function globalSetup() {
  // D-016: E2E never runs against production. APP_ENV must be local or test (checked in addition to the host allow list).
  if (process.env.APP_ENV !== 'local' && process.env.APP_ENV !== 'test') {
    throw new Error(`E2E requires APP_ENV=local or APP_ENV=test (got "${process.env.APP_ENV ?? ''}"). Refusing to run.`)
  }
  const targets = [process.env.E2E_BASE_URL ?? 'http://localhost:3000', process.env.E2E_CONTENT_URL ?? 'http://127.0.0.1:3000']
  // E2E_ALLOWED_HOSTS: comma separated hostnames of the TEST environment (set by a human). Never put production hostnames here.
  const allowed = new Set(['localhost', '127.0.0.1', ...(process.env.E2E_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)])
  for (const t of targets) {
    const host = new URL(t).hostname
    if (!allowed.has(host)) {
      throw new Error(`E2E target host "${host}" is not in the allowed list (localhost, 127.0.0.1, E2E_ALLOWED_HOSTS). Refusing to run.`)
    }
  }
}
