// eslint.config.mjs
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const DRIZZLE_PACKAGES = ['drizzle-orm', 'drizzle-orm/*', 'drizzle-kit', 'postgres']
const INTERNAL_DATA_PATHS = ['@/server/repositories', '@/server/repositories/*', '@/server/db', '@/server/db/*', '@/server/auth/supabase-admin']

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'drizzle/**', 'playwright-report/**', 'test-results/**', '_archive/**', 'next-env.d.ts']),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error', // no @ts-ignore / @ts-expect-error without review
      'react/no-danger': 'error', // dangerouslySetInnerHTML is forbidden (02 5.7 / 9.2.7)
    },
  },
  // Drizzle and postgres.js may only be imported in repositories / db (CLAUDE.md). scripts/ and drizzle.config.ts are tooling.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/repositories/**', 'src/server/db/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: DRIZZLE_PACKAGES, message: 'Import Drizzle / postgres only in src/server/repositories or src/server/db.' }] }] },
  },
  // repositories / db / supabase-admin may only be imported by services (02 2.5 item 3). Tests may import them.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/services/**', 'src/server/repositories/**', 'src/server/db/**', 'src/server/auth/**', 'src/**/*.test.{ts,tsx}', 'src/tests/**', 'src/app/api/health/route.ts', 'src/app/api/cron/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: [...DRIZZLE_PACKAGES, ...INTERNAL_DATA_PATHS], message: 'Use a service function. Repositories / db / supabase-admin are only imported from src/server/services.' }] }] },
  },
  // Client components must not import server code (ARCHITECTURE 3). A glob cannot match a directive, so the selector looks for
  // a file whose directive prologue contains 'use client' and then flags its imports of @/server/** and server-only.
  // (esquery regex literals cannot contain '/', hence '.' in /^@.server/.) Server-only files never carry this directive, so
  // the later no-restricted-syntax blocks for _actions and route.ts (which replace this one for those globs) are unaffected.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Program:has(ExpressionStatement[directive='use client']) > ImportDeclaration[source.value=/^@.server/]",
          message: "Client components ('use client') must not import src/server/**. Pass data from a server component, or call a Server Action.",
        },
        {
          selector: "Program:has(ExpressionStatement[directive='use client']) > ImportDeclaration[source.value='server-only']",
          message: "'use client' files must not import server-only.",
        },
      ],
    },
  },
  // 'use server' action files: only `export const x = defineAction(...)` (and type exports). Any other export becomes a public endpoint.
  {
    files: ['src/app/**/_actions/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "ExportNamedDeclaration[exportKind='value'] > FunctionDeclaration", message: 'Do not export raw functions from a use-server file. Use defineAction.' },
        { selector: "ExportNamedDeclaration[exportKind='value'] > VariableDeclaration > VariableDeclarator:not([init.callee.name='defineAction'])", message: 'Only defineAction(...) results may be exported from a use-server file.' },
        { selector: "ExportNamedDeclaration[exportKind='value'][specifiers.length>0]", message: 'No re-exports from a use-server file.' },
        { selector: 'ExportDefaultDeclaration', message: 'No default export in a use-server file.' },
        { selector: 'ExportAllDeclaration', message: 'No export * in a use-server file.' },
      ],
    },
  },
  // Route handlers: HTTP methods via defineRoute, plus route segment config constants.
  {
    files: ['src/app/**/route.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "ExportNamedDeclaration > FunctionDeclaration", message: 'Export route handlers via defineRoute (auth must be declared).' },
        { selector: "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator:not([init.callee.name='defineRoute']):not([id.name=/^(maxDuration|dynamic|runtime|preferredRegion|revalidate)$/])", message: 'Only defineRoute(...) and route segment config may be exported from route.ts.' },
      ],
    },
  },
])
