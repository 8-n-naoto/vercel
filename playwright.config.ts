// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { DEFAULT_BASE_URL, envOrDefault } from './e2e/support/base-url'

const baseURL = envOrDefault(process.env.E2E_BASE_URL, DEFAULT_BASE_URL)

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  // The specs share the seed users and their state (display name, rate-limit counters), so run the files one after another.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    // Logs in once per role and saves e2e/.auth/*.json (login:email is 5 / 15 min and counts successes).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  // Local runs: start the app yourself (use `npm run build && npm run start` for E2E; `next dev` compiles too slowly). Two origins need two hostnames, see 7.1.
})
