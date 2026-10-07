// Mechanical authorization coverage (02 2.5, 07 13.3 AZ-07..AZ-09, 06 11). Fails when a Server Action, Route Handler or page
// bypasses defineAction / defineRoute / pageContext, or when a public path is added without updating 06 11.
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTION_BRAND } from '@/server/actions/brand'
import { ROUTE_BRAND } from '@/server/http/brand'
import { PUBLIC_PAGES } from '@/server/page-registry'

// Dynamic imports pull the whole server import chain (cold transform ~2s alone, >5s under load): give those tests a real budget
// per test instead of raising the global testTimeout.
const IMPORT_TIMEOUT = 30_000
const ROOT = process.cwd()
const rel = (p: string) => p.split(path.sep).join('/')
const files = (pattern: string) => globSync(pattern, { cwd: ROOT }).map(rel).sort()
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')
const load = async (f: string): Promise<Record<string, unknown>> => await import(/* @vite-ignore */ path.join(ROOT, f))

// 06 11 (approved public paths). Update 06 11, ARCHITECTURE 5 and this list together.
const APPROVED_PUBLIC_ACTIONS = ['auth.signIn', 'invites.accept', 'passwordReset.complete', 'view.openShareLink']
// AZ-09 / 06 10: the only route handlers that may exist, with their auth and host.
const APPROVED_ROUTES: Record<string, { auth: string; host: string }> = {
  '/raw/[ticket]': { auth: 'ticket', host: 'content' },
  '/api/cron/daily': { auth: 'cron', host: 'app' },
  '/api/health': { auth: 'cron', host: 'app' },
}
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const ROUTE_SEGMENT_CONFIG = ['maxDuration', 'dynamic', 'runtime', 'preferredRegion', 'revalidate']

const stripGroups = (p: string) => p.split('/').filter((s) => !(s.startsWith('(') && s.endsWith(')'))).join('/')
const routeOf = (file: string, suffix: RegExp) => '/' + stripGroups(file.replace(/^src\/app\//, '').replace(suffix, '')).replace(/^\/+|\/+$/g, '')
const camel = (name: string) => name.split('.').map((s, i) => (i === 0 ? s : s[0]?.toUpperCase() + s.slice(1))).join('')

interface Branded {
  name: string
  auth: string
  host?: string
}
const brandOf = (value: unknown, brand: symbol): Branded | null => {
  if (typeof value !== 'function') return null
  const b: unknown = Reflect.get(value, brand)
  if (typeof b !== 'object' || b === null) return null
  const name: unknown = Reflect.get(b, 'name')
  const auth: unknown = Reflect.get(b, 'auth')
  const host: unknown = Reflect.get(b, 'host')
  if (typeof name !== 'string' || typeof auth !== 'string') return null
  return { name, auth, host: typeof host === 'string' ? host : undefined }
}

// Colocated unit tests (e.g. view.test.ts) are not actions: importing them would register suites inside a test.
const actionFiles = files('src/app/**/_actions/*.ts').filter((f) => !/\.test\.tsx?$/.test(f))
const routeFiles = files('src/app/**/route.ts')
const pageFiles = files('src/app/**/page.tsx')

describe('authz coverage: Server Actions (AZ-08)', () => {
  it("'use server' appears only in src/app/**/_actions/*.ts, and every _actions file starts with it", () => {
    const offenders = files('src/**/*.{ts,tsx}')
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('src/tests/'))
      .filter((f) => /^\s*(['"])use server\1/m.test(read(f)) && !actionFiles.includes(f))
    expect(offenders, "'use server' outside _actions/ makes every export a public endpoint").toEqual([])
    const missing = actionFiles.filter((f) => !/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use server\2/.test(read(f)))
    expect(missing).toEqual([])
  })

  it('every export of every _actions file is a defineAction result named after its action', async () => {
    const problems: string[] = []
    for (const f of actionFiles) {
      const mod = await load(f)
      for (const [key, value] of Object.entries(mod)) {
        const b = brandOf(value, ACTION_BRAND)
        if (!b) problems.push(`${f}: export "${key}" is not created by defineAction`)
        else if (!['public', 'user', 'admin'].includes(b.auth)) problems.push(`${f}: "${key}" has auth "${b.auth}"`)
        else if (key !== camel(b.name)) problems.push(`${f}: export "${key}" should be "${camel(b.name)}" (06 1.1)`)
      }
    }
    expect(problems).toEqual([])
  }, IMPORT_TIMEOUT)

  it('AZ-07: auth public actions are within the approved list of 06 11 (equality is required once WP-1.x adds all four)', async () => {
    const pub: string[] = []
    for (const f of actionFiles) {
      for (const value of Object.values(await load(f))) {
        const b = brandOf(value, ACTION_BRAND)
        if (b?.auth === 'public') pub.push(b.name)
      }
    }
    expect(APPROVED_PUBLIC_ACTIONS).toEqual(expect.arrayContaining(pub))
    expect(new Set(pub).size).toBe(pub.length)
  }, IMPORT_TIMEOUT)
})

describe('authz coverage: Route Handlers (AZ-09)', () => {
  it('every route.ts exports only defineRoute results (and segment config), with the approved auth and host', async () => {
    const problems: string[] = []
    for (const f of routeFiles) {
      const route = routeOf(f, /\/route\.ts$/)
      const approved = APPROVED_ROUTES[route]
      if (!approved) problems.push(`${f}: route "${route}" is not in the approved list (06 10, 06 11)`)
      const mod = await load(f)
      const methods = Object.keys(mod).filter((k) => HTTP_METHODS.includes(k))
      if (methods.length === 0) problems.push(`${f}: no HTTP method export`)
      for (const [key, value] of Object.entries(mod)) {
        if (ROUTE_SEGMENT_CONFIG.includes(key)) continue
        const b = HTTP_METHODS.includes(key) ? brandOf(value, ROUTE_BRAND) : null
        if (!b) problems.push(`${f}: export "${key}" is not an HTTP method created by defineRoute`)
        else if (b.auth === 'public') problems.push(`${f}: ${key} is auth "public" (none is approved, 06 11)`)
        else if (approved && (b.auth !== approved.auth || b.host !== approved.host)) {
          problems.push(`${f}: ${key} is ${b.auth}/${b.host}, expected ${approved.auth}/${approved.host}`)
        }
      }
    }
    expect(problems).toEqual([])
  }, IMPORT_TIMEOUT)
})

describe('authz coverage: pages (06 11)', () => {
  it('pages that call pageContext with auth public are within PUBLIC_PAGES; all other pages call pageContext', () => {
    const publicPages: string[] = []
    const noContext: string[] = []
    for (const f of pageFiles) {
      const src = read(f)
      if (!/\bpageContext\s*\(/.test(src)) {
        noContext.push(f)
        continue
      }
      if (/\bauth:\s*(['"])public\1/.test(src)) publicPages.push(routeOf(f, /\/page\.tsx$/))
    }
    expect(noContext, 'pages must call pageContext({ auth }) (layout alone is not enough)').toEqual([])
    expect([...PUBLIC_PAGES]).toEqual(expect.arrayContaining(publicPages)) // equality once S01/S02/S03/S09 exist
  })
})

describe('authz coverage: scanner sanity', () => {
  it('finds the files it is supposed to scan (guards against a broken glob)', () => {
    expect(pageFiles).toContain('src/app/page.tsx')
    expect(files('src/server/**/*.ts')).toContain('src/server/actions/define-action.ts')
  })
})
