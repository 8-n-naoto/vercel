import { describe, it, expect } from 'vitest'
import { decideFolderAccess } from './folder'
import { FA_CASES, FA_X_CASES } from '@/tests/fixtures/authz'
import { itCoversSpec07 } from '@/tests/helpers/spec07'

describe('decideFolderAccess (07 13.1)', () => {
  itCoversSpec07('FA', FA_CASES.map((c) => c.id))
  it.each(FA_CASES)('$id', ({ role, row, need, expected }) => {
    expect(decideFolderAccess({ role }, row, need)).toEqual(expected)
  })
})

describe('decideFolderAccess boundaries outside 07 (T-018)', () => {
  it.each(FA_X_CASES)('$id', ({ role, row, need, expected }) => {
    expect(decideFolderAccess({ role }, row, need)).toEqual(expected)
  })
})
