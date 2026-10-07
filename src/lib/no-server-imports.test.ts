import { readFileSync, globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// src/lib is shared with client components: it must not pull in server-only or src/server (WP-0.P1 completion condition).
describe('src/lib is importable from the browser', () => {
  const files = globSync('src/lib/**/*.{ts,tsx}').filter((f) => !/\.test\.tsx?$/.test(f))

  it('finds the library files', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files)('%s has no server-only / src/server import', (file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/from\s+['"]server-only['"]|import\s+['"]server-only['"]/)
    expect(source).not.toMatch(/from\s+['"]@\/server\//)
    expect(source).not.toMatch(/from\s+['"]\.\.?\/.*server\//)
  })
})
