import { describe, expect, it } from 'vitest'
import { foldersCreateInput, foldersDeleteInput, foldersUpdateInput } from './folders'

const id = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'

describe('foldersCreateInput (06 6.1)', () => {
  it('trims, defaults the description to empty and is strict', () => {
    expect(foldersCreateInput.parse({ name: '  Docs ' })).toEqual({ name: 'Docs', description: '' })
    expect(foldersCreateInput.safeParse({ name: 'a', extra: 1 }).success).toBe(false)
  })
  it('requires a name of 1..100 characters and a description of at most 500', () => {
    expect(foldersCreateInput.safeParse({ name: '   ' }).success).toBe(false)
    expect(foldersCreateInput.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
    expect(foldersCreateInput.safeParse({ name: 'a'.repeat(100) }).success).toBe(true)
    expect(foldersCreateInput.safeParse({ name: 'a', description: 'd'.repeat(501) }).success).toBe(false)
  })
})

describe('foldersUpdateInput (06 6.2)', () => {
  it('needs a uuid, a name and a description', () => {
    expect(foldersUpdateInput.safeParse({ folderId: id, name: 'n', description: '' }).success).toBe(true)
    expect(foldersUpdateInput.safeParse({ folderId: 'abc', name: 'n', description: '' }).success).toBe(false)
    expect(foldersUpdateInput.safeParse({ folderId: id, name: 'n' }).success).toBe(false)
  })
})

describe('foldersDeleteInput (06 6.3)', () => {
  it('needs a uuid and a non-empty confirmName of at most 100 characters', () => {
    expect(foldersDeleteInput.safeParse({ folderId: id, confirmName: 'x' }).success).toBe(true)
    expect(foldersDeleteInput.safeParse({ folderId: id, confirmName: '  ' }).success).toBe(false)
    expect(foldersDeleteInput.safeParse({ folderId: id, confirmName: 'x'.repeat(101) }).success).toBe(false)
    expect(foldersDeleteInput.safeParse({ folderId: 'abc', confirmName: 'x' }).success).toBe(false)
  })
})
