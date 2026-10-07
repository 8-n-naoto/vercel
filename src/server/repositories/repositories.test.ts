import { describe, expect, it } from 'vitest'
import * as repositories from './index'
import { NotImplementedError } from './not-implemented'

// Repositories already implemented by their WP (WP-1.4: rate_limits, audit_logs); they need a DB and are covered by integration tests.
const IMPLEMENTED = new Set(['incrementRateLimit', 'incrementRateLimitAt', 'deleteRateLimitsByKeyPrefix', 'binWindowStart', 'countRateLimitRows', 'insertAuditLog'])

type AnyRepoFn = (...args: never[]) => Promise<unknown>

// The skeleton must fail loudly until the owning WP replaces each body, so a missed implementation is detected.
describe('repository skeleton', () => {
  const fns: [string, AnyRepoFn][] = Object.entries<unknown>(repositories).flatMap(([name, value]) =>
    typeof value === 'function' && !IMPLEMENTED.has(name) ? [[name, value as AnyRepoFn] as [string, AnyRepoFn]] : [],
  )

  it('exports at least one function per table', () => {
    expect(fns.length).toBeGreaterThanOrEqual(7)
  })

  it.each(fns)('%s throws NotImplementedError', async (_name, fn) => {
    await expect(fn(...([] as never[]))).rejects.toBeInstanceOf(NotImplementedError)
  })
})
