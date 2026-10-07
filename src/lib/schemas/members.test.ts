import { describe, expect, it } from 'vitest'
import { membersAddInput, membersRemoveInput } from './members'

const f = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'
const u1 = '00000000-0000-4000-8000-000000000001'
const u2 = '00000000-0000-4000-8000-000000000002'

describe('membersAddInput (06 6.4)', () => {
  it('accepts 1..50 distinct uuids', () => {
    expect(membersAddInput.safeParse({ folderId: f, userIds: [u1, u2] }).success).toBe(true)
    const many = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
    expect(membersAddInput.safeParse({ folderId: f, userIds: many }).success).toBe(true)
    expect(membersAddInput.safeParse({ folderId: f, userIds: [...many, u2.replace(/2$/, '9')] }).success).toBe(false)
  })
  it('rejects an empty list, a non-uuid and extra keys', () => {
    expect(membersAddInput.safeParse({ folderId: f, userIds: [] }).success).toBe(false)
    expect(membersAddInput.safeParse({ folderId: f, userIds: ['x'] }).success).toBe(false)
    expect(membersAddInput.safeParse({ folderId: f, userIds: [u1], extra: 1 }).success).toBe(false)
  })
  it('rejects duplicates on userIds with the identifier duplicate', () => {
    const r = membersAddInput.safeParse({ folderId: f, userIds: [u1, u1] })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.some((i) => i.path[0] === 'userIds' && i.message === 'duplicate')).toBe(true)
  })
})

describe('membersRemoveInput (06 6.5)', () => {
  it('needs two uuids and is strict', () => {
    expect(membersRemoveInput.safeParse({ folderId: f, userId: u1 }).success).toBe(true)
    expect(membersRemoveInput.safeParse({ folderId: f, userId: 'x' }).success).toBe(false)
    expect(membersRemoveInput.safeParse({ folderId: f, userId: u1, extra: 1 }).success).toBe(false)
  })
})
