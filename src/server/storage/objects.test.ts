import { describe, expect, it, vi } from 'vitest'
import { createObjectsAdapter, ObjectsError, type BucketApi } from './objects'

const SECRET_URL = 'https://x.supabase.co/storage/v1/object/sign/files/p?token=SECRET-TOKEN'
const ok = <T>(data: T) => Promise.resolve({ data, error: null })
const ng = () => Promise.resolve({ data: null, error: { message: `boom ${SECRET_URL}` } })

function bucket(over: Partial<BucketApi> = {}): BucketApi {
  return {
    createSignedUploadUrl: () => ok({ signedUrl: 'https://u' }),
    createSignedUrl: () => ok({ signedUrl: SECRET_URL }),
    info: () => ok({ size: 5, contentType: 'text/html' }),
    list: () => ok([]),
    remove: () => ok([]),
    ...over,
  }
}
const adapter = (b: BucketApi, f: typeof fetch = vi.fn<typeof fetch>()) => createObjectsAdapter({ bucket: () => b, fetch: f })
const streamOf = (n: number) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(n).fill(7))
      c.close()
    },
  })

describe('createSignedUploadUrl', () => {
  it('returns the signed URL; failure throws without the SDK message', async () => {
    expect(await adapter(bucket()).createSignedUploadUrl('p')).toEqual({ signedUrl: 'https://u' })
    const err = await adapter(bucket({ createSignedUploadUrl: ng })).createSignedUploadUrl('p').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ObjectsError)
    expect(err instanceof Error ? err.message : '').not.toContain('SECRET')
  })
})

describe('stat', () => {
  it('uses info first', async () => {
    const list = vi.fn(() => ok([]))
    expect(await adapter(bucket({ list })).stat('d/f.html')).toEqual({ size: 5, mimeType: 'text/html' })
    expect(list).not.toHaveBeenCalled()
  })
  it('falls back to list(dir, search) and returns null when absent', async () => {
    const list = vi.fn(() => ok([{ name: 'f.html', id: 'i', metadata: { size: 9, mimetype: 'text/html' } }]))
    const a = adapter(bucket({ info: ng, list }))
    expect(await a.stat('d/f.html')).toEqual({ size: 9, mimeType: 'text/html' })
    expect(list).toHaveBeenCalledWith('d', { search: 'f.html', limit: 100 })
    expect(await adapter(bucket({ info: ng, list: () => ok([]) })).stat('d/f.html')).toBeNull()
  })
  it('throws when list also fails', async () => {
    await expect(adapter(bucket({ info: ng, list: ng })).stat('d/f')).rejects.toBeInstanceOf(ObjectsError)
  })
})

describe('readHead', () => {
  it('sends Range and returns the 206 body', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(4).fill(1), { status: 206 }))
    const out = await adapter(bucket(), f).readHead('p', 4)
    expect(out).toHaveLength(4)
    expect(f).toHaveBeenCalledWith(SECRET_URL, { headers: { Range: 'bytes=0-3' } })
  })
  it('truncates a 200 full response to `bytes` and cancels the rest', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(3).fill(2))
      },
      cancel,
    })
    const f = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }))
    const out = await adapter(bucket(), f).readHead('p', 4)
    expect(out).toEqual(new Uint8Array([2, 2, 2, 2]))
    expect(cancel).toHaveBeenCalled()
  })
  it('returns less when the object is shorter', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(streamOf(2), { status: 200 }))
    expect(await adapter(bucket(), f).readHead('p', 4096)).toHaveLength(2)
  })
  it('does not leak the signed URL on fetch failure or bad status', async () => {
    const f1 = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fail ${SECRET_URL}`)
    })
    const e1 = await adapter(bucket(), f1).readHead('p', 4).catch((e: unknown) => e)
    expect(e1).toBeInstanceOf(ObjectsError)
    expect(e1 instanceof Error ? e1.message : '').not.toContain('SECRET')
    expect(e1 instanceof Error ? e1.cause : 'x').toBeUndefined()
    const f2 = vi.fn<typeof fetch>(async () => new Response('nope', { status: 404 }))
    await expect(adapter(bucket(), f2).readHead('p', 4)).rejects.toBeInstanceOf(ObjectsError)
    await expect(adapter(bucket({ createSignedUrl: ng }), f2).readHead('p', 4)).rejects.toBeInstanceOf(ObjectsError)
  })
})

describe('openStream', () => {
  it('returns the stream unbuffered with content-length', async () => {
    const res = new Response(streamOf(3), { status: 200, headers: { 'content-length': '3' } })
    const f = vi.fn<typeof fetch>(async () => res)
    const s = await adapter(bucket(), f).openStream('p')
    expect(s).toMatchObject({ status: 200, contentLength: 3 })
    expect(s.body).toBe(res.body)
  })
  it('contentLength null without the header', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(streamOf(1), { status: 200 }))
    expect((await adapter(bucket(), f).openStream('p')).contentLength).toBeNull()
  })
})

describe('remove / removeMany', () => {
  it('success counts as removed; SDK error puts the chunk into failed', async () => {
    expect(await adapter(bucket()).remove('a')).toEqual({ removed: ['a'], failed: [] })
    expect(await adapter(bucket({ remove: ng })).removeMany(['a', 'b'])).toEqual({ removed: [], failed: ['a', 'b'] })
  })
  it('chunks by 100 and isolates a failing chunk', async () => {
    const paths = Array.from({ length: 150 }, (_, i) => `p${i}`)
    let n = 0
    const remove = vi.fn(() => (n++ === 0 ? ng() : ok([])))
    const r = await adapter(bucket({ remove })).removeMany(paths)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(r.failed).toHaveLength(100)
    expect(r.removed).toHaveLength(50)
  })
  it('a thrown SDK error is reported as failed', async () => {
    const r = await adapter(bucket({ remove: () => Promise.reject(new Error('x')) })).remove('a')
    expect(r.failed).toEqual(['a'])
  })
})

describe('listAll', () => {
  it('walks folders and pages by 1000', async () => {
    const file = (name: string) => ({ name, id: 'i', metadata: { size: 1, mimetype: 'text/html' } })
    const page1 = [{ name: 'dir', id: null, metadata: null }, ...Array.from({ length: 999 }, (_, i) => file(`r${i}`))]
    const list = vi.fn(async (prefix?: string, opts?: { offset?: number }) => {
      if (prefix === '' && opts?.offset === 0) return { data: page1, error: null }
      if (prefix === '') return { data: [file('last')], error: null }
      if (prefix === 'dir') return { data: [file('f.html')], error: null }
      return { data: [], error: null }
    })
    const seen: string[] = []
    for await (const o of adapter(bucket({ list })).listAll()) seen.push(o.path)
    expect(seen).toHaveLength(1001)
    expect(seen).toContain('dir/f.html')
    expect(seen).toContain('last')
  })
  it('throws on list error', async () => {
    const run = async () => {
      for await (const o of adapter(bucket({ list: ng })).listAll()) void o
    }
    await expect(run()).rejects.toBeInstanceOf(ObjectsError)
  })
})
