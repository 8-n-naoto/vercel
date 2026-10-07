import { describe, expect, it } from 'vitest'
import { adminCreateInviteInput, adminIssuePasswordResetInput, adminRevokeInviteInput } from './admin'

describe('adminCreateInviteInput (06 5.1)', () => {
  it('trims and lowercases the email', () => {
    const r = adminCreateInviteInput.safeParse({ email: ' Foo@Example.COM ', role: 'user' })
    expect(r.success && r.data).toEqual({ email: 'foo@example.com', role: 'user' })
  })
  it('rejects a bad email, an unknown role and extra keys', () => {
    expect(adminCreateInviteInput.safeParse({ email: 'nope', role: 'user' }).success).toBe(false)
    expect(adminCreateInviteInput.safeParse({ email: 'a@example.com', role: 'owner' }).success).toBe(false)
    expect(adminCreateInviteInput.safeParse({ email: 'a@example.com', role: 'admin', x: 1 }).success).toBe(false)
  })
})

describe('adminRevokeInviteInput (06 5.2)', () => {
  it('requires a uuid and nothing else', () => {
    expect(adminRevokeInviteInput.safeParse({ inviteId: '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60' }).success).toBe(true)
    expect(adminRevokeInviteInput.safeParse({ inviteId: 'abc' }).success).toBe(false)
    expect(adminRevokeInviteInput.safeParse({ inviteId: '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60', y: 1 }).success).toBe(false)
  })
})

describe('adminIssuePasswordResetInput (06 5.3)', () => {
  it('requires a uuid and nothing else', () => {
    expect(adminIssuePasswordResetInput.safeParse({ userId: '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60' }).success).toBe(true)
    expect(adminIssuePasswordResetInput.safeParse({ userId: 'abc' }).success).toBe(false)
    expect(adminIssuePasswordResetInput.safeParse({ userId: '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60', z: 1 }).success).toBe(false)
  })
})
