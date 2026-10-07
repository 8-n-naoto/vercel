import { describe, it, expect } from 'vitest'
import { decideFolderAccess } from './folder'
import { FA_CASES } from '@/tests/fixtures/authz'

describe('decideFolderAccess (07 13.1)', () => {
  it.each(FA_CASES)('$id', ({ role, row, need, expected }) => {
    expect(decideFolderAccess({ role }, row, need)).toEqual(expected)
  })
})
