import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./src/tests/stubs/server-only.ts', import.meta.url)) },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/tests/integration/**/*.test.ts'],
    // Real .env.local values are loaded by the setup file (tsx/vitest do not load it automatically); never commit values.
    setupFiles: ['src/tests/integration/setup.ts'],
    fileParallelism: false, // tests share one dev database; run files one at a time
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
