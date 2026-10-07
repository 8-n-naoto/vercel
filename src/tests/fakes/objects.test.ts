import { beforeEach, describe, expect, it } from 'vitest'
import { ObjectsError } from '@/server/storage/objects'
import { createFakeObjects } from './objects'

const fake = createFakeObjects()
const bytes = new TextEncoder().encode('<html>hello</html>')

beforeEach(() => fake.reset())

describe('fake objects contract', () => {
  it('put -> stat -> readHead -> openStream -> remove -> stat null', async () => {
    fake.put('a/b.html', bytes, 'text/html')
    expect(await fake.stat('a/b.html')).toEqual({ size: bytes.length, mimeType: 'text/html' })
    expect(await fake.readHead('a/b.html', 6)).toEqual(bytes.slice(0, 6))
    const s = await fake.openStream('a/b.html')
    expect(s.status).toBe(200)
    expect(s.contentLength).toBe(bytes.length)
    expect(new Uint8Array(await new Response(s.body).arrayBuffer())).toEqual(bytes)
    expect(await fake.remove('a/b.html')).toEqual({ removed: ['a/b.html'], failed: [] })
    expect(await fake.stat('a/b.html')).toBeNull()
  })

  it('removing a missing path succeeds', async () => {
    expect(await fake.remove('none')).toEqual({ removed: ['none'], failed: [] })
  })

  it('failNext(remove) fails once, keeps the object, then recovers', async () => {
    fake.put('x', bytes, 'text/html')
    fake.failNext('remove')
    expect(await fake.remove('x')).toEqual({ removed: [], failed: ['x'] })
    expect(fake.has('x')).toBe(true)
    expect(await fake.remove('x')).toEqual({ removed: ['x'], failed: [] })
  })

  it('failNext(removeMany) reports all paths as failed', async () => {
    fake.put('x', bytes, 'text/html')
    fake.put('y', bytes, 'text/html')
    fake.failNext('removeMany')
    expect((await fake.removeMany(['x', 'y'])).failed).toEqual(['x', 'y'])
  })

  it('failNext(stat) throws ObjectsError once', async () => {
    fake.failNext('stat')
    await expect(fake.stat('x')).rejects.toBeInstanceOf(ObjectsError)
    expect(await fake.stat('x')).toBeNull()
  })

  it('listAll yields every object; reset clears', async () => {
    fake.put('a/1', bytes, 'text/html')
    fake.put('b/2', bytes, 'text/html')
    const seen: string[] = []
    for await (const o of fake.listAll()) seen.push(o.path)
    expect(seen.sort()).toEqual(['a/1', 'b/2'])
    fake.reset()
    const after: string[] = []
    for await (const o of fake.listAll()) after.push(o.path)
    expect(after).toHaveLength(0)
  })

  it('createSignedUploadUrl returns a URL', async () => {
    expect((await fake.createSignedUploadUrl('p')).signedUrl).toContain('p')
  })
})
