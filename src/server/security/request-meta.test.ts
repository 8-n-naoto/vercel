import { beforeEach, describe, expect, it, vi } from 'vitest'

const headerMap = new Map<string, string>()
vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => headerMap.get(k) ?? null }) }))

import { getRequestMeta } from './request-meta'

beforeEach(() => headerMap.clear())

describe('getRequestMeta (06 1.8)', () => {
  it('takes the first element of x-forwarded-for', async () => {
    headerMap.set('x-forwarded-for', '203.0.113.5, 10.0.0.1, 10.0.0.2')
    expect((await getRequestMeta()).ip).toBe('203.0.113.5')
  })
  it('accepts IPv6', async () => {
    headerMap.set('x-forwarded-for', '2001:db8::1')
    expect((await getRequestMeta()).ip).toBe('2001:db8::1')
  })
  it.each([['missing', undefined], ['empty', ''], ['hostname', 'example.com'], ['hex-only word', 'abc'], ['dots only', '...'], ['zone id', 'fe80::1%eth0'], ['out of range', '999.1.1.1'], ['leading comma', ', 1.2.3.4']])(
    'ip is null when the header is %s',
    async (_n, v) => {
      if (v !== undefined) headerMap.set('x-forwarded-for', v)
      expect((await getRequestMeta()).ip).toBeNull()
    },
  )
  it('truncates user-agent to 256 chars; null when missing', async () => {
    expect((await getRequestMeta()).userAgent).toBeNull()
    headerMap.set('user-agent', 'a'.repeat(300))
    expect((await getRequestMeta()).userAgent).toHaveLength(256)
  })
  it('requestId: x-vercel-id, else a generated uuid', async () => {
    headerMap.set('x-vercel-id', 'hnd1::abc')
    expect((await getRequestMeta()).requestId).toBe('hnd1::abc')
    headerMap.clear()
    expect((await getRequestMeta()).requestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
