// In-memory Storage adapter for tests (07 14). Same interface as src/server/storage/objects.ts.
import { ObjectsError, type ObjectsAdapter, type ObjectsOp, type RemoveResult } from '@/server/storage/objects'

export interface FakeObjects extends ObjectsAdapter {
  /** Places an object (what a browser PUT to the signed URL would do). */
  put(path: string, bytes: Uint8Array, mimeType: string): void
  has(path: string): boolean
  /** The next call of `op` (once) fails: remove / removeMany report every path as failed, the others throw ObjectsError. */
  failNext(op: ObjectsOp): void
  reset(): void
}

export function createFakeObjects(): FakeObjects {
  const store = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  const failures = new Set<ObjectsOp>()

  const shouldFail = (op: ObjectsOp): boolean => failures.delete(op)
  const failOrThrow = (op: ObjectsOp): void => {
    if (shouldFail(op)) throw new ObjectsError(op)
  }
  const removePaths = (paths: string[], op: ObjectsOp): RemoveResult => {
    if (shouldFail(op)) return { removed: [], failed: [...paths] }
    for (const p of paths) store.delete(p)
    return { removed: [...paths], failed: [] }
  }
  const toStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice())
        controller.close()
      },
    })

  return {
    put: (path, bytes, mimeType) => void store.set(path, { bytes: bytes.slice(), mimeType }),
    has: (path) => store.has(path),
    failNext: (op) => void failures.add(op),
    reset: () => {
      store.clear()
      failures.clear()
    },

    async createSignedUploadUrl(path) {
      failOrThrow('createSignedUploadUrl')
      return { signedUrl: `https://fake.invalid/upload/${encodeURIComponent(path)}` }
    },
    async stat(path) {
      failOrThrow('stat')
      const o = store.get(path)
      return o ? { size: o.bytes.length, mimeType: o.mimeType } : null
    },
    async readHead(path, bytes) {
      failOrThrow('readHead')
      const o = store.get(path)
      if (!o) throw new ObjectsError('readHead')
      return o.bytes.slice(0, bytes)
    },
    async openStream(path) {
      failOrThrow('openStream')
      const o = store.get(path)
      if (!o) throw new ObjectsError('openStream')
      return { status: 200, body: toStream(o.bytes), contentLength: o.bytes.length }
    },
    async remove(path) {
      return removePaths([path], 'remove')
    },
    async removeMany(paths) {
      return removePaths(paths, 'removeMany')
    },
    async *listAll() {
      failOrThrow('listAll')
      for (const [path, o] of [...store.entries()]) yield { path, size: o.bytes.length }
    },
  }
}
