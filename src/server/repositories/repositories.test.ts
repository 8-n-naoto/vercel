import { describe, expect, it } from 'vitest'
import * as repositories from './index'
import { NotImplementedError } from './not-implemented'

type AnyRepoFn = (...args: never[]) => Promise<unknown>

// The skeleton must fail loudly until the owning WP replaces each body, so a missed implementation is detected.
describe('repository skeleton', () => {
  const fns: [string, AnyRepoFn][] = Object.entries<unknown>(repositories).flatMap(([name, value]) =>
    typeof value === 'function' ? [[name, value as AnyRepoFn] as [string, AnyRepoFn]] : [],
  )

  it('exports at least one function per table', () => {
    expect(fns.length).toBeGreaterThanOrEqual(9)
  })

  it.each(fns)('%s throws NotImplementedError', async (_name, fn) => {
    await expect(fn(...([] as never[]))).rejects.toBeInstanceOf(NotImplementedError)
  })
})
