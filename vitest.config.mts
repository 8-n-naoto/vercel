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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'e2e/**', '.next/**', '_archive/**', 'src/tests/integration/**'], // integration tests: npm run test:integration (07 14)
    setupFiles: ['src/tests/setup.ts'],
    coverage: { provider: 'v8', include: ['src/server/**', 'src/lib/**'], reporter: ['text-summary', 'lcov'] },
  },
})
