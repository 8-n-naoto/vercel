import { describe, expect, it } from 'vitest'
import { accountChangePasswordInput, accountUpdateProfileInput } from './account'

const pw = { currentPassword: 'old-password-123', newPassword: 'new-password-1234', newPasswordConfirm: 'new-password-1234' }

describe('accountUpdateProfileInput (06 4.5)', () => {
  it('trims and requires 1..50 characters, strict', () => {
    expect(accountUpdateProfileInput.parse({ displayName: '  Taro ' }).displayName).toBe('Taro')
    expect(accountUpdateProfileInput.safeParse({ displayName: '   ' }).success).toBe(false)
    expect(accountUpdateProfileInput.safeParse({ displayName: 'a'.repeat(51) }).success).toBe(false)
    expect(accountUpdateProfileInput.safeParse({ displayName: 'a', extra: 1 }).success).toBe(false)
  })
})

describe('accountChangePasswordInput (06 4.6)', () => {
  it('accepts a valid input', () => {
    expect(accountChangePasswordInput.safeParse(pw).success).toBe(true)
  })
  it('rejects a confirmation mismatch on newPasswordConfirm', () => {
    const r = accountChangePasswordInput.safeParse({ ...pw, newPasswordConfirm: 'different-pass-1' })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.some((i) => i.path[0] === 'newPasswordConfirm' && i.message === 'password_mismatch')).toBe(true)
  })
  it('rejects a new password equal to the current one on newPassword', () => {
    const same = 'same-password-123'
    const r = accountChangePasswordInput.safeParse({ currentPassword: same, newPassword: same, newPasswordConfirm: same })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues.some((i) => i.path[0] === 'newPassword' && i.message === 'password_same_as_current')).toBe(true)
  })
  it('enforces length bounds and strictness', () => {
    expect(accountChangePasswordInput.safeParse({ ...pw, currentPassword: '' }).success).toBe(false)
    expect(accountChangePasswordInput.safeParse({ ...pw, newPassword: 'short', newPasswordConfirm: 'short' }).success).toBe(false)
    expect(accountChangePasswordInput.safeParse({ ...pw, extra: 1 }).success).toBe(false)
  })
})
