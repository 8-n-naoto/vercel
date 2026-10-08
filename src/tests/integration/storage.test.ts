// WP-3.2 integration: the real adapter against the dev Storage bucket (06 7.7, 04 11.2 D14). NOT RUN when written (T-031);
// run with npm run test:integration. Skipped unless SUPABASE_URL is set and APP_ENV is local/test.
// Only objects under the dedicated prefix "spike/<uuid>/" are created and removed.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getObjects } from '@/server/storage/objects'

const enabled = Boolean(process.env.SUPABASE_URL) && (process.env.APP_ENV === 'local' || process.env.APP_ENV === 'test')
const prefix = `spike/${randomUUID()}`
const path = `${prefix}/a.html`
const body = '<!doctype html><title>t</title>' + 'x'.repeat(6000)

afterAll(async () => {
  if (enabled) await getObjects().remove(path)
})

describe.skipIf(!enabled)('objects adapter against the dev bucket', () => {
  it('PUT to a signed upload URL -> stat -> readHead -> openStream -> remove -> stat null', async () => {
    const objects = getObjects()
    const { signedUrl } = await objects.createSignedUploadUrl(path)
    const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': 'text/html' }, body })
    expect(put.ok).toBe(true)

    expect(await objects.stat(path)).toEqual({ size: body.length, mimeType: 'text/html' })

    const head = await objects.readHead(path, 4096)
    expect(head).toHaveLength(4096)
    expect(new TextDecoder().decode(head.slice(0, 15))).toBe('<!doctype html>')

    const stream = await objects.openStream(path)
    expect(stream.status).toBe(200)
    expect(new TextDecoder().decode(new Uint8Array(await new Response(stream.body).arrayBuffer()))).toBe(body)

    expect(await objects.remove(path)).toEqual({ removed: [path], failed: [] })
    expect(await objects.stat(path)).toBeNull()
    expect(await objects.remove(path)).toEqual({ removed: [path], failed: [] }) // missing path is success
  })
})

// F-014: readHead on objects larger than 4096 bytes hung inside the Next.js runtime (awaiting reader.cancel() on the patched
// fetch body). This guards the adapter against the real Storage with a time limit; the Next-runtime part is covered by E2E S06-1.
describe.skipIf(!enabled)('readHead on objects larger than the head (F-014)', () => {
  it.each([8 * 1024, 1024 * 1024])('returns 4096 bytes of a %i byte object within 5 seconds', async (size) => {
    const objects = getObjects()
    const p = `spike/${randomUUID()}/big-${size}.html`
    try {
      const { signedUrl } = await objects.createSignedUploadUrl(p)
      const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<!doctype html>' + 'y'.repeat(size - 15) })
      expect(put.ok).toBe(true)
      const t0 = Date.now()
      const head = await objects.readHead(p, 4096)
      expect(Date.now() - t0).toBeLessThan(5000)
      expect(head).toHaveLength(4096)
      expect(new TextDecoder().decode(head.slice(0, 15))).toBe('<!doctype html>')
    } finally {
      await objects.remove(p)
    }
  }, 20_000)
})
