import { describe, expect, it } from 'vitest'
import {
  filesCancelUploadInput,
  filesDeleteInput,
  filesFinalizeUploadInput,
  filesStartUploadInput,
  filesUpdateInput,
  filesUpdateRestrictionsInput,
} from './files'

const id = '3f1c2b0e-6c2a-4f5e-9d3a-1b2c3d4e5f60'
const start = { folderId: id, originalFilename: 'a.html', displayName: null, sizeBytes: 10, contentType: 'text/html' }

describe('filesStartUploadInput (06 7.1)', () => {
  it('accepts .html / .htm in any case and defaults displayName to null', () => {
    expect(filesStartUploadInput.parse({ ...start, displayName: undefined }).displayName).toBeNull()
    expect(filesStartUploadInput.safeParse({ ...start, originalFilename: 'A.HTM' }).success).toBe(true)
  })
  it('rejects other extensions, path separators and control characters', () => {
    expect(filesStartUploadInput.safeParse({ ...start, originalFilename: 'a.txt' }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, originalFilename: 'a/b.html' }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, originalFilename: 'a\\b.html' }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, originalFilename: 'a\u0001.html' }).success).toBe(false)
  })
  it('limits length and size', () => {
    expect(filesStartUploadInput.safeParse({ ...start, originalFilename: 'a'.repeat(251) + '.html' }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, sizeBytes: 0 }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, sizeBytes: 1.5 }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, contentType: 'x'.repeat(101) }).success).toBe(false)
    expect(filesStartUploadInput.safeParse({ ...start, extra: 1 }).success).toBe(false)
  })
})

describe('fileId inputs (06 7.2 / 7.3 / 7.6)', () => {
  it.each([filesFinalizeUploadInput, filesCancelUploadInput, filesDeleteInput])('needs a uuid and is strict', (s) => {
    expect(s.safeParse({ fileId: id }).success).toBe(true)
    expect(s.safeParse({ fileId: 'x' }).success).toBe(false)
    expect(s.safeParse({ fileId: id, a: 1 }).success).toBe(false)
  })
})

describe('filesUpdateInput (06 7.4)', () => {
  it('needs at least one of displayName / charset', () => {
    expect(filesUpdateInput.safeParse({ fileId: id }).success).toBe(false)
    expect(filesUpdateInput.safeParse({ fileId: id, displayName: ' n ' }).success).toBe(true)
    expect(filesUpdateInput.safeParse({ fileId: id, charset: 'shift_jis' }).success).toBe(true)
    expect(filesUpdateInput.safeParse({ fileId: id, charset: 'latin1' }).success).toBe(false)
  })
})

describe('filesUpdateRestrictionsInput (06 7.5)', () => {
  const base = { fileId: id, suspended: false, viewStartsAt: null, viewEndsAt: null, expiresAt: null, downloadAllowed: false }
  it('accepts nulls and requires viewStartsAt < viewEndsAt', () => {
    expect(filesUpdateRestrictionsInput.safeParse(base).success).toBe(true)
    const bad = filesUpdateRestrictionsInput.safeParse({ ...base, viewStartsAt: '2026-10-10T09:00:00+09:00', viewEndsAt: '2026-10-10T09:00:00+09:00' })
    expect(bad.success).toBe(false)
    expect(filesUpdateRestrictionsInput.safeParse({ ...base, viewStartsAt: '2026-10-10T09:00:00+09:00', viewEndsAt: '2026-10-11T09:00:00+09:00' }).success).toBe(true)
  })
  it('requires an offset in date-times', () => {
    expect(filesUpdateRestrictionsInput.safeParse({ ...base, expiresAt: '2026-10-10T09:00:00' }).success).toBe(false)
  })
})
