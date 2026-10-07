import { describe, expect, it } from 'vitest'
import { authSignInInput } from './auth'

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
