import { describe, expect, it } from 'vitest'
import { authSignInInput, invitesAcceptInput, passwordResetCompleteInput } from './auth'

const base = { email: 'a@example.com', password: 'x' }

describe('authSignInInput (06 4.1)', () => {
  it('accepts a relative next and defaults it to null', () => {
    expect(authSignInInput.parse({ ...base, next: '/admin/users' }).next).toBe('/admin/users')
    expect(authSignInInput.parse(base).next).toBeNull()
    expect(authSignInInput.parse({ ...base, next: null }).next).toBeNull()
  })
  it('rejects protocol-relative, absolute and empty next', () => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil', '', 'folders']) {
      expect(authSignInInput.safeParse({ ...base, next }).success, next).toBe(false)
    }
  })
  it('trims and lowercases the email', () => {
    expect(authSignInInput.parse({ ...base, email: '  Foo@Example.COM ' }).email).toBe('foo@example.com')
  })
  it('password is 1..72 characters and is not trimmed', () => {
    expect(authSignInInput.safeParse({ ...base, password: '' }).success).toBe(false)
    expect(authSignInInput.safeParse({ ...base, password: 'a'.repeat(72) }).success).toBe(true)
    expect(authSignInInput.safeParse({ ...base, password: 'a'.repeat(73) }).success).toBe(false)
    expect(authSignInInput.parse({ ...base, password: ' a ' }).password).toBe(' a ')
  })
  it('is strict', () => {
    expect(authSignInInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})

describe('invitesAcceptInput / passwordResetCompleteInput (06 4.3 / 4.4)', () => {
  const token = 'A'.repeat(43)
  const pw = 'a'.repeat(12)
  const accept = { token, displayName: 'Taro', password: pw, passwordConfirm: pw }
  const reset = { token, password: pw, passwordConfirm: pw }

  it('accepts valid input', () => {
    expect(invitesAcceptInput.safeParse(accept).success).toBe(true)
    expect(passwordResetCompleteInput.safeParse(reset).success).toBe(true)
  })
  it('password is 12..72 characters', () => {
    for (const [len, ok] of [[11, false], [12, true], [72, true], [73, false]] as const) {
      const p = 'a'.repeat(len)
      expect(invitesAcceptInput.safeParse({ ...accept, password: p, passwordConfirm: p }).success, `accept ${len}`).toBe(ok)
      expect(passwordResetCompleteInput.safeParse({ ...reset, password: p, passwordConfirm: p }).success, `reset ${len}`).toBe(ok)
    }
  })
  it('a mismatch is reported on passwordConfirm', () => {
    for (const r of [
      invitesAcceptInput.safeParse({ ...accept, passwordConfirm: pw + 'b' }),
      passwordResetCompleteInput.safeParse({ ...reset, passwordConfirm: pw + 'b' }),
    ]) {
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'passwordConfirm' && i.message === 'password_mismatch')).toBe(true)
    }
  })
  it('token must be 43 base64url characters', () => {
    for (const t of ['', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(42) + '=']) {
      expect(invitesAcceptInput.safeParse({ ...accept, token: t }).success, t).toBe(false)
      expect(passwordResetCompleteInput.safeParse({ ...reset, token: t }).success, t).toBe(false)
    }
  })
  it('displayName is trimmed, 1..50 characters', () => {
    expect(invitesAcceptInput.safeParse({ ...accept, displayName: '   ' }).success).toBe(false)
    expect(invitesAcceptInput.safeParse({ ...accept, displayName: 'a'.repeat(50) }).success).toBe(true)
    expect(invitesAcceptInput.safeParse({ ...accept, displayName: 'a'.repeat(51) }).success).toBe(false)
  })
  it('are strict', () => {
    expect(invitesAcceptInput.safeParse({ ...accept, extra: 1 }).success).toBe(false)
    expect(passwordResetCompleteInput.safeParse({ ...reset, displayName: 'x' }).success).toBe(false)
  })
})
