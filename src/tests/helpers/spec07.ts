// Cross-check helper between test fixtures and the ID tables of docs/07 (section 14: IDs in test names).
// docs/ is not in CI, so the check is skipped when the file is missing (existsSync + it.skipIf).
import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const docUrl = new URL('../../../docs/07_業務ロジック仕様とテストケース.md', import.meta.url)
export const hasSpec07 = existsSync(docUrl)

export interface SpecIdOptions {
  /** IDs with a number >= this value are integration tests (DB needed) and are not expected in unit tests. */
  integrationFrom?: number
}

/** Unit-test IDs of one prefix found in table rows of 07, in document order. Rows marked (結合) are excluded. */
export function specIds(prefix: string, opts: SpecIdOptions = {}): string[] {
  const md = readFileSync(docUrl, 'utf8')
  const re = new RegExp(String.raw`^\| (${prefix}-(\d+))([^|]*)\|`, 'gm')
  const ids: string[] = []
  for (const m of md.matchAll(re)) {
    const id = m[1]
    const n = Number(m[2])
    const rest = m[3] ?? ''
    if (id === undefined || rest.includes('結合')) continue
    if (opts.integrationFrom !== undefined && n >= opts.integrationFrom) continue
    ids.push(id)
  }
  return ids
}

/** Normalizes fixture ids: 'TK-12a' -> 'TK-12'; duplicates removed; order kept. */
export const baseIds = (ids: string[]): string[] => [...new Set(ids.map((id) => id.replace(/^([A-Z]+-\d+).*$/, '$1')))]

/**
 * Registers a test that the covered IDs equal the unit-test IDs of 07 for the prefix (no missing, no extra).
 * Extra IDs that are not in 07 must use an 'X' marker (e.g. TK-X01) and are ignored here.
 */
export function itCoversSpec07(prefix: string, covered: string[], opts: SpecIdOptions = {}): void {
  it.skipIf(!hasSpec07)(`fixture covers every ${prefix} row in 07`, () => {
    const mine = baseIds(covered.filter((id) => !id.includes('-X')))
    expect(new Set(mine).size).toBe(mine.length)
    expect([...mine].sort()).toEqual([...specIds(prefix, opts)].sort())
  })
}
