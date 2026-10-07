import { describe, expect, it } from 'vitest'
import { viewOpenAsMemberInput, viewOpenShareLinkInput, viewRequestMemberDownloadInput } from './view'

const id = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'
const token = 'A'.repeat(43)

describe.each([
  ['viewOpenAsMemberInput', viewOpenAsMemberInput],
  ['viewRequestMemberDownloadInput', viewRequestMemberDownloadInput],
])('%s (06 8.4 / 8.5)', (_n, schema) => {
  it('accepts a uuid and rejects others', () => {
    expect(schema.safeParse({ fileId: id }).success).toBe(true)
    expect(schema.safeParse({ fileId: 'x' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })
  it('is strict', () => {
    expect(schema.safeParse({ fileId: id, extra: 1 }).success).toBe(false)
  })
})

describe('viewOpenShareLinkInput (06 8.6)', () => {
  it('defaults password to null', () => {
    expect(viewOpenShareLinkInput.parse({ token }).password).toBeNull()
  })
  it('limits token format and password length, and is strict', () => {
    expect(viewOpenShareLinkInput.safeParse({ token: 'short' }).success).toBe(false)
    expect(viewOpenShareLinkInput.safeParse({ token, password: '' }).success).toBe(false)
    expect(viewOpenShareLinkInput.safeParse({ token, password: 'x'.repeat(129) }).success).toBe(false)
    expect(viewOpenShareLinkInput.safeParse({ token, password: 'x'.repeat(128) }).success).toBe(true)
    expect(viewOpenShareLinkInput.safeParse({ token, extra: 1 }).success).toBe(false)
  })
})
