import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { evaluateAccess, decideIncrementFailure } from './access-policy'
import { EA_CASES, IN_CASES, buildInput } from '@/tests/fixtures/access'

const docUrl = new URL('../../../docs/07_業務ロジック仕様とテストケース.md', import.meta.url)
// docs/ is not committed; the cross-check runs locally only
const hasDoc = existsSync(docUrl)

describe('evaluateAccess (07 1.3)', () => {
  it('fixture has EA-01..EA-72 without gaps or duplicates', () => {
    expect(EA_CASES.map((c) => c.id)).toEqual(Array.from({ length: 72 }, (_, i) => `EA-${String(i + 1).padStart(2, '0')}`))
  })
  it.skipIf(!hasDoc)('fixture covers every EA row in 07 1.3', () => {
    const md = readFileSync(docUrl, 'utf8')
    const ids = [...md.matchAll(/^\| (EA-\d+) \|/gm)].map((m) => m[1])
    expect(ids).toEqual(EA_CASES.map((c) => c.id))
  })
  it.each(EA_CASES)('$id', ({ via, stage, purpose, over, expected }) => {
    expect(evaluateAccess(buildInput(via, stage, purpose, over))).toEqual(expected)
  })
})

describe('decideIncrementFailure (07 2.3)', () => {
  it.each(IN_CASES)('$id', ({ row, expected, unexplained }) => {
    const spy = vi.fn()
    expect(decideIncrementFailure(row, spy)).toBe(expected)
    expect(spy).toHaveBeenCalledTimes(unexplained ? 1 : 0)
  })
})
